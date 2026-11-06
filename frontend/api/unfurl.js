/**
 * Vercel Serverless Function — /api/unfurl?url=<encoded>
 *
 * Link previews for chat messages (M3). Fetches a page server-side
 * (browsers can't, CORS) and returns its Open Graph card fields.
 * The client renders a preview only when a title or image comes
 * back; every failure path returns a minimal 200 so a bad link
 * never breaks a thread.
 *
 * Safety: http/https only, literal private/loopback hostnames are
 * rejected, 5s timeout, body read capped. This validates the URL as
 * written; it is a team-app-grade guard, not a hardened SSRF wall.
 */

const PRIVATE_V4 = [
  /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, /^0\./,
]

function hostAllowed(hostname) {
  const h = hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return false
  return !PRIVATE_V4.some(re => re.test(h))
}

function metaContent(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || []
  for (const tag of tags) {
    const prop = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)
    if (!prop || prop[1].toLowerCase() !== key) continue
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)
    if (content) return decodeEntities(content[1].trim())
  }
  return null
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
}

export default async function handler(req, res) {
  const raw = req.query?.url
  let target
  try {
    target = new URL(raw)
    if (!/^https?:$/.test(target.protocol)) throw new Error('protocol')
    if (!hostAllowed(target.hostname)) throw new Error('host')
  } catch {
    return res.status(200).json({ url: typeof raw === 'string' ? raw : null, title: null })
  }

  try {
    const r = await fetch(target.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; TTL-LinkPreview/1.0)',
        'accept': 'text/html,application/xhtml+xml',
      },
    })
    const type = r.headers.get('content-type') || ''
    if (!r.ok || !type.includes('text/html')) {
      return res.status(200).json({ url: target.toString(), title: null })
    }
    const html = (await r.text()).slice(0, 512_000)
    const finalUrl = r.url || target.toString()
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    let image = metaContent(html, 'og:image')
    if (image) {
      try { image = new URL(image, finalUrl).toString() } catch { image = null }
    }
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return res.status(200).json({
      url: finalUrl,
      title: metaContent(html, 'og:title') || (titleTag ? decodeEntities(titleTag[1].trim()) : null),
      description: metaContent(html, 'og:description') || metaContent(html, 'description'),
      image,
      siteName: metaContent(html, 'og:site_name') || target.hostname.replace(/^www\./, ''),
    })
  } catch {
    return res.status(200).json({ url: target.toString(), title: null })
  }
}
