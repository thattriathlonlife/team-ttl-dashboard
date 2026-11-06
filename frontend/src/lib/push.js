// push.js — Web Push subscription management (M4).
//
// The app is an installed PWA; push rides the standard Web Push
// protocol. The public VAPID key is a client constant (it is not a
// secret); the private key lives ONLY in private_config and is used
// by api/push-send.js. Subscriptions are stored per athlete in
// push_subscriptions (migration 0010, own-row RLS).

// The supabase client is imported lazily inside the functions that
// need it — it reads import.meta.env at module load, which keeps
// this module importable (and its pure helpers testable) anywhere.

export const VAPID_PUBLIC_KEY = 'BNErCqZthiM8lsg-ERjD5alXPyDn8qqwD_L4RmPMxu1l657VWBVNKph3eeqF9ObjJoCRszL5sS3YIQUxCJm6d9s'

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported() {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
}

// One of: unsupported | denied | off | on
export async function getPushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

export async function enablePush(userId) {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'denied' }
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  const json = sub.toJSON()
  const { supabase } = await import('./supabase.js')
  const { error } = await supabase.from('push_subscriptions').upsert({
    athlete_id: userId,
    kind: 'webpush',
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh || null,
    auth: json.keys?.auth || null,
    user_agent: navigator.userAgent.slice(0, 200),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'athlete_id,endpoint' })
  if (error) return { ok: false, reason: 'save-failed' }
  return { ok: true }
}

export async function disablePush(userId) {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const { supabase } = await import('./supabase.js')
      await supabase.from('push_subscriptions').delete()
        .eq('athlete_id', userId).eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch { /* best effort — server row cleanup matters most */ }
  return { ok: true }
}
