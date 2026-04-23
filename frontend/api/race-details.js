/**
 * Vercel Serverless Function — /api/race-details
 * Fetches an IRONMAN race page server-side (no CORS issues)
 * and extracts swim type, bike profile, run profile, and description.
 *
 * Usage: GET /api/race-details?url=https://www.ironman.com/races/im703-brasilia
 */

export default async function handler(req, res) {
  // CORS headers so the frontend can call this
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const { url } = req.query

  if (!url || !url.startsWith('https://www.ironman.com/races/')) {
    return res.status(400).json({ error: 'Invalid or missing race URL' })
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      return res.status(200).json({ error: 'Race page not found', status: response.status })
    }

    const html = await response.text()

    // ── Extract description ──────────────────────────────────────
    let description = null
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{20,400})["']/i)
      || html.match(/<meta[^>]*content=["']([^"']{20,400})["'][^>]*name=["']description["']/i)
    if (descMatch) description = descMatch[1].trim()

    // ── Extract swim/bike/run course details ─────────────────────
    // IRONMAN pages include course info in text near keywords
    // We scan the full HTML text for these patterns

    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

    // Swim type — look for ocean, lake, river, bay, reservoir, open water
    let swimType = null
    const swimMatch = text.match(/swim[^.]{0,60}?(ocean|lake|river|bay|reservoir|lagoon|open water|loch|sea|harbour|harbor)/i)
      || text.match(/(ocean|lake|river|bay|reservoir|lagoon|loch|sea)[^.]{0,40}?swim/i)
    if (swimMatch) {
      const raw = (swimMatch[1] || swimMatch[2] || '').toLowerCase()
      swimType = raw.charAt(0).toUpperCase() + raw.slice(1)
    }

    // Bike profile — look for flat, rolling, hilly, challenging
    let bikeProfile = null
    const bikeMatch = text.match(/bike[^.]{0,80}?(flat|rolling|hilly|challenging|undulating|mixed)/i)
      || text.match(/cycling[^.]{0,80}?(flat|rolling|hilly|challenging|undulating|mixed)/i)
      || text.match(/(flat|rolling|hilly|challenging|undulating)[^.]{0,40}?bike/i)
    if (bikeMatch) {
      const raw = (bikeMatch[1] || bikeMatch[2] || '').toLowerCase()
      bikeProfile = raw === 'undulating' ? 'Rolling' : raw.charAt(0).toUpperCase() + raw.slice(1)
    }

    // Run profile — look for flat, rolling, hilly
    let runProfile = null
    const runMatch = text.match(/run[^.]{0,80}?(flat|rolling|hilly|challenging|undulating|mixed)/i)
      || text.match(/(flat|rolling|hilly|challenging|undulating)[^.]{0,40}?run/i)
    if (runMatch) {
      const raw = (runMatch[1] || runMatch[2] || '').toLowerCase()
      runProfile = raw === 'undulating' ? 'Rolling' : raw.charAt(0).toUpperCase() + raw.slice(1)
    }

    // ── Extract distance info ────────────────────────────────────
    let distances = null
    const swimDistMatch = text.match(/swim[:\s]+(\d+[\.,]?\d*\s*(?:km|miles?|m\b))/i)
    const bikeDistMatch = text.match(/bike[:\s]+(\d+[\.,]?\d*\s*(?:km|miles?))/i)
    const runDistMatch = text.match(/run[:\s]+(\d+[\.,]?\d*\s*(?:km|miles?))/i)
    if (swimDistMatch || bikeDistMatch || runDistMatch) {
      distances = {
        swim: swimDistMatch?.[1]?.trim() || null,
        bike: bikeDistMatch?.[1]?.trim() || null,
        run: runDistMatch?.[1]?.trim() || null,
      }
    }

    return res.status(200).json({
      description,
      swimType,
      bikeProfile,
      runProfile,
      distances,
    })

  } catch (err) {
    console.error('[race-details]', err.message)
    return res.status(200).json({ error: err.message })
  }
}
