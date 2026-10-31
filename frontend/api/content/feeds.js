/**
 * Vercel Serverless Function — /api/content/feeds
 *
 * Aggregates TTL's public content sources for the unified app's Content tab.
 * The content originates on TTL's own public properties (Shopify blog,
 * Buzzsprout) — this function only normalises it to JSON. No Firebase,
 * no scraping of anything private, no credentials.
 *
 * GET /api/content/feeds -> { stories: [...], episodes: [...] }
 */

const SOURCES = {
  stories: 'https://thattriathlonlife.com/blogs/journal.atom',
  episodes: 'https://rss.buzzsprout.com/1922707.rss',
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
    return {
      title: tag(block, 'title'),
      link: link ? link[1] : null,
      published: tag(block, 'published') || tag(block, 'updated'),
      summary: (tag(block, 'summary') || '').slice(0, 220),
      image: firstImage(block),
    }
  })
}

function parseRss(xml, limit) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit)
  return items.map(([, block]) => {
    const enc = block.match(/<enclosure[^>]+url="([^"]+)"[^>]*type="audio[^"]*"/) || block.match(/<enclosure[^>]+url="([^"]+)"/)
    return {
      title: tag(block, 'title'),
      link: tag(block, 'link'),
      published: tag(block, 'pubDate'),
      audio: enc ? enc[1] : null,
      duration: tag(block, 'itunes:duration'),
      summary: (tag(block, 'description') || '').slice(0, 220),
    }
  })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const [storiesRes, episodesRes] = await Promise.all([
      fetch(SOURCES.stories),
      fetch(SOURCES.episodes),
    ])
    if (!storiesRes.ok || !episodesRes.ok) {
      return res.status(502).json({ error: 'Upstream feed error' })
    }
    const [storiesXml, episodesXml] = await Promise.all([storiesRes.text(), episodesRes.text()])

    // Feeds change on TTL's publishing cadence, not ours — cache hard at the edge.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600')
    return res.status(200).json({
      stories: parseAtom(storiesXml, 20),
      episodes: parseRss(episodesXml, 30),
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    return res.status(502).json({ error: 'Feed fetch failed', detail: String(err).slice(0, 200) })
  }
}
