// pageCache — module-level stale-while-revalidate cache for page data.
//
// Route changes unmount pages, so every tab switch used to re-run the
// page's full data waterfall behind a blank loading screen (Zack's
// 2026-11-01 recording: "page switching feels pretty slow"). Pages now
// hydrate their state from this cache on mount — rendering the last
// known data instantly — while their normal load still runs and
// refreshes in the background. Lives only for the session: a full
// reload (including the demo tier switch, which reloads the page)
// starts cold, so cached data can never leak across tiers or users.
const store = new Map()

export function pageCacheGet(key) {
  return store.get(key) || null
}

export function pageCacheSet(key, value) {
  store.set(key, value)
}
