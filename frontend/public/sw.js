// Team TTL service worker — Phase 0 PWA shell.
// Strategy: navigations network-first with cache fallback (fresh app wins,
// offline still opens); static assets cache-first; API calls network-first
// with a short-lived cache fallback for the content feed only.
const VERSION = 'ttl-sw-v4'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')))
    return
  }
  if (url.pathname.startsWith('/api/content/')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone()
          caches.open(VERSION).then((c) => c.put(e.request, copy))
          return r
        })
        .catch(() => caches.match(e.request))
    )
    return
  }
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)))
  }
})

// ─── Web Push (M4) ───────────────────────────────────────────────────
// Payloads are JSON from api/push-send.js: { title, body, url, tag }.
// The notification deep-links into the thread; clicking focuses an
// existing app window when there is one instead of stacking tabs.
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data ? e.data.text() : '' } }
  const title = data.title || 'That Triathlon Life'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/messages' },
  }
  e.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = (e.notification.data && e.notification.data.url) || '/messages'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === location.origin) {
          w.navigate(target).catch(() => {})
          return w.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
