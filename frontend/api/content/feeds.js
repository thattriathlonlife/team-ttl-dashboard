/**
 * Vercel Serverless Function — /api/content/feeds
 *
 * Aggregates TTL's public content sources for the unified app's Content tab.
 * The content originates on TTL's own public properties (Shopify blog,
 * Buzzsprout) — this function only normalises it to JSON. No Firebase,
 * no scraping of anything private, no credentials.
 *
 * GET /api/content/feeds -> { stories: [...], episodes: [...], videos: [...] }
 */

const SOURCES = {
  stories: 'https://thattriathlonlife.com/blogs/journal.atom',
  episodes: 'https://rss.buzzsprout.com/1922707.rss',
  // YouTube's per-channel RSS endpoint 404s for this channel (verified
  // 2026-10-31), so videos come from the channel's own /videos page data —
  // still TTL's own public property, same sourcing rule as the feeds above.
  videosPage: 'https://www.youtube.com/@ThatTriathlonLife/videos',
}

function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim()
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decodeEntities(m[1]) : null
}

// Raw variant for article bodies: unwrap CDATA (or unescape) WITHOUT
// stripping markup — the app renders story HTML in its own reader so
// reading never leaves the app (Zack, 2026-11-01).
function rawTag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  if (!m) return null
  const s = m[1].trim()
  const cd = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  if (cd) return cd[1]
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function firstImage(block) {
  const media = block.match(/<media:content[^>]+url="([^"]+)"/)
  if (media) return media[1]
  const img = block.match(/<img[^>]+src="([^"]+)"/)
  return img ? img[1] : null
}

function parseAtom(xml, limit) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, limit)
  return entries.map(([, block]) => {
    const link = block.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/) || block.match(/<link[^>]+href="([^"]+)"/)
    const author = block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/)
    return {
      title: tag(block, 'title'),
      link: link ? link[1] : null,
      published: tag(block, 'published') || tag(block, 'updated'),
      summary: (tag(block, 'summary') || '').slice(0, 220),
      image: firstImage(block),
      author: author ? decodeEntities(author[1]) : null,
      body: rawTag(block, 'content'),
    }
  })
}

function parseRss(xml, limit) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit)
  return items.map(([, block]) => {
    const enc = block.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="audio[^"]*"/) || block.match(/<enclosure[^>]+url="([^"]+)"/)
    const img = block.match(/<itunes:image[^>]+href="([^"]+)"/)
    return {
      title: tag(block, 'title'),
      link: tag(block, 'link'),
      published: tag(block, 'pubDate'),
      audio: enc ? enc[1] : null,
      duration: tag(block, 'itunes:duration'),
      summary: (tag(block, 'description') || '').slice(0, 220),
      image: img ? img[1] : null,
    }
  })
}

function channelImage(xml) {
  const head = xml.split('<item>')[0]
  const itunes = head.match(/<itunes:image[^>]+href="([^"]+)"/)
  if (itunes) return itunes[1]
  const img = head.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/)
  return img ? img[1].trim() : null
}

const AGE_UNITS = { minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3 }

function approxDateFromAge(ageLabel) {
  const m = String(ageLabel || '').match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/)
  if (!m) return null
  return new Date(Date.now() - Number(m[1]) * AGE_UNITS[m[2]]).toISOString()
}

// The /videos page embeds ytInitialData whose video "lockups" carry the id,
// title, thumbnail, view count, and a relative age ("3 weeks ago"). The grid
// is newest-first; ages convert to approximate dates — good enough to rank
// videos against episodes and stories in the Home feed, and the raw age
// label is passed through for display so nothing pretends to be exact.
function parseYouTubeVideos(html, limit) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/)
  if (!m) return []
  let data
  try { data = JSON.parse(m[1]) } catch { return [] }

  const lockups = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (!Array.isArray(node) && node.lockupViewModel) lockups.push(node.lockupViewModel)
    for (const v of Object.values(node)) walk(v)
  }
  walk(data)

  const seen = new Set()
  const videos = []
  for (const lk of lockups) {
    if (lk?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue
    const id = lk.contentId
    if (!id || seen.has(id)) continue
    seen.add(id)
    const meta = lk.metadata?.lockupMetadataViewModel || {}
    const rows = meta.metadata?.contentMetadataViewModel?.metadataRows || []
    const parts = rows.flatMap(r => r.metadataParts || [])
    const views = parts[0]?.accessibilityLabel || null
    const age = parts.map(p => p.accessibilityLabel).find(t => /ago/.test(t || '')) || null
    // Canonical thumbnail from the video id — the signed hq720 URLs in
    // the page markup expire, which broke thumbnails in the app whenever
    // a cached feed response outlived the signature (2026-11-01).
    const image = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
    videos.push({
      id,
      title: meta.title?.content || null,
      link: `https://www.youtube.com/watch?v=${id}`,
      published: approxDateFromAge(age),
      age,
      views,
      image,
    })
    if (videos.length >= limit) break
  }
  return videos
}

async function fetchVideos() {
  try {
    const r = await fetch(SOURCES.videosPage, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' },
    })
    if (!r.ok) return []
    return parseYouTubeVideos(await r.text(), 15)
  } catch {
    return [] // Videos are additive — never fail the whole feed for them.
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const [storiesRes, episodesRes, videos] = await Promise.all([
      fetch(SOURCES.stories),
      fetch(SOURCES.episodes),
      fetchVideos(),
    ])
    if (!storiesRes.ok || !episodesRes.ok) {
      return res.status(502).json({ error: 'Upstream feed error' })
    }
    const [storiesXml, episodesXml] = await Promise.all([storiesRes.text(), episodesRes.text()])

    // Feeds change on TTL's publishing cadence, not ours — cache hard at the edge.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600')
    const podcastImage = channelImage(episodesXml)
    // Default payload serves the Home feed (recent slices). ?full=1 serves
    // the archive page: complete catalogues, in order. Totals always ride
    // along so the feed can label its archive entry points truthfully.
    const full = (req.url || '').includes('full=1')
    return res.status(200).json({
      stories: parseAtom(storiesXml, full ? 60 : 20),
      storiesTotal: (storiesXml.match(/<entry>/g) || []).length,
      episodes: parseRss(episodesXml, full ? 300 : 30).map(ep => ({ ...ep, image: ep.image || podcastImage })),
      episodesTotal: (episodesXml.match(/<item>/g) || []).length,
      podcastImage,
      videos,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    return res.status(502).json({ error: 'Feed fetch failed', detail: String(err).slice(0, 200) })
  }
}
