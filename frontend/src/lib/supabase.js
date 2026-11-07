import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Run 67: the auth client's default lock (the browser Web Locks API)
// can deadlock on iOS — sign-in calls wait forever and never return an
// error (2026-11-06: password sign-in hung indefinitely in both the
// installed app and Safari on the same phone, while the server answered
// identical test calls in ~1s). This app is a single-instance client,
// so run auth operations without the cross-context lock; the accepted
// tradeoff is that two simultaneously open tabs no longer serialize
// their token refreshes.
const noLock = async (_name, _acquireTimeout, fn) => await fn()

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { lock: noLock },
})
