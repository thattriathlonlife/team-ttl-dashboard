// Display-mode detection (run 66).
//
// The installed (Home Screen / standalone) app must default to sign-in
// methods that finish INSIDE the app: a magic link always opens in the
// browser, iOS keeps the browser's storage separate from the installed
// app's, so the installed app never sees that sign-in — and browser
// tabs can't receive Web Push at all. The email-code flow completes
// in place, so standalone defaults to it.

export function isStandaloneDisplay({ mediaStandalone = false, iosStandalone = false } = {}) {
  return !!(mediaStandalone || iosStandalone)
}

// The sign-in tab the login screen should open on.
export function defaultAuthMode(standalone) {
  return standalone ? 'code' : 'password'
}

export function detectStandalone() {
  if (typeof window === 'undefined') return false
  return isStandaloneDisplay({
    mediaStandalone: typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches,
    iosStandalone: window.navigator?.standalone === true,
  })
}
