import { useState } from 'react'
import { supabase } from '../lib/supabase'

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0d0d0d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    position: 'relative',
    overflow: 'hidden',
  },
  stripes: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '100%',
    height: '6px',
    background: 'linear-gradient(90deg, #00B5B9 0%, #00B5B9 25%, #E87362 25%, #E87362 50%, #E8B84B 50%, #E8B84B 75%, #E87362 75%, #E87362 100%)',
  },
  stripesTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '6px',
    background: 'linear-gradient(90deg, #00B5B9 0%, #00B5B9 25%, #E87362 25%, #E87362 50%, #E8B84B 50%, #E8B84B 75%, #E87362 75%, #E87362 100%)',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    textAlign: 'center',
  },
  logo: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '64px',
    fontWeight: 900,
    letterSpacing: '4px',
    color: '#fff',
    lineHeight: 1,
    marginBottom: '4px',
  },
  logoSub: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '14px',
    letterSpacing: '6px',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: '48px',
  },
  heading: {
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '24px',
    fontWeight: 700,
    letterSpacing: '2px',
    textTransform: 'uppercase',
    color: '#fff',
    marginBottom: '8px',
  },
  sub: {
    fontSize: '14px',
    color: '#888',
    marginBottom: '32px',
    lineHeight: 1.6,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  input: {
    background: '#1f1f1f',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#fff',
    padding: '14px 16px',
    fontSize: '15px',
    fontFamily: 'Barlow, sans-serif',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.15s',
  },
  btn: {
    background: '#00B5B9',
    color: '#000',
    border: 'none',
    borderRadius: '6px',
    padding: '14px',
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '16px',
    fontWeight: 700,
    letterSpacing: '2px',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    marginTop: '4px',
  },
  success: {
    background: 'rgba(0, 181, 185, 0.1)',
    border: '1px solid rgba(0, 181, 185, 0.3)',
    borderRadius: '8px',
    padding: '20px',
    color: '#00B5B9',
    fontFamily: 'Barlow Condensed, sans-serif',
    fontSize: '16px',
    letterSpacing: '1px',
  },
  error: {
    background: 'rgba(232, 115, 98, 0.1)',
    border: '1px solid rgba(232, 115, 98, 0.3)',
    borderRadius: '6px',
    padding: '12px',
    color: '#E87362',
    fontSize: '13px',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '4px 0',
    color: '#444',
    fontSize: '12px',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(255,255,255,0.08)',
  },
}

export default function Login() {
  // Multi-method auth (auth amendment, 2026-10-31): password is primary,
  // email code and magic link are fallbacks. "Continue with Shopify" activates
  // when TTL creates the Customer Account API client (see AUTH-AMENDMENT.md);
  // the button is shown disabled so the target shape is visible in the POC.
  const [mode, setMode] = useState('password') // 'password' | 'code' | 'link'
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handlePassword(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const fn = isSignUp ? supabase.auth.signUp : supabase.auth.signInWithPassword
    const { error } = await fn({ email, password })
    setLoading(false)
    if (error) setError(error.message)
    else if (isSignUp) setSent('signup')
  }

  async function handleSendCode(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    setLoading(false)
    if (error) setError(error.message); else setCodeSent(true)
  }

  async function handleVerifyCode(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    setLoading(false)
    if (error) setError(error.message)
  }

  async function handleLink(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setLoading(false)
    if (error) setError(error.message); else setSent('link')
  }

  const tabBtn = (m, label) => (
    <button type="button" onClick={() => { setMode(m); setError(''); setCodeSent(false) }}
      style={{ flex: 1, background: mode === m ? '#1f1f1f' : 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: mode === m ? '#fff' : '#888', padding: '9px 4px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', cursor: 'pointer' }}>
      {label}
    </button>
  )

  return (
    <div style={styles.page}>
      <div style={styles.stripesTop} />
      <div style={styles.stripes} />
      <div style={styles.card}>
        <div style={styles.logo}>TTL</div>
        <div style={styles.logoSub}>That Triathlon Life</div>

        {sent ? (
          <div style={styles.success}>
            {sent === 'link' ? 'Check your email for a magic link to sign in.' : 'Account created — check your email to confirm, then sign in.'}
          </div>
        ) : (
          <>
            <div style={styles.heading}>{isSignUp && mode === 'password' ? 'Create Account' : 'Sign In'}</div>
            <div style={styles.sub}>
              Team members get the full app; everyone can browse races, the map, and TTL content.
            </div>

            <button type="button" disabled title="Activates when the TTL store creates its Customer Account API client"
              style={{ ...styles.btn, width: '100%', background: '#222', color: '#777', cursor: 'not-allowed', marginBottom: 6 }}>
              Continue with Shopify — coming soon
            </button>
            <div style={styles.divider}><div style={styles.dividerLine} />or<div style={styles.dividerLine} /></div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {tabBtn('password', 'Password')}
              {tabBtn('code', 'Email code')}
              {tabBtn('link', 'Magic link')}
            </div>

            {mode === 'password' && (
              <form style={styles.form} onSubmit={handlePassword}>
                <input style={styles.input} type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
                <input style={styles.input} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
                {error && <div style={styles.error}>{error}</div>}
                <button style={styles.btn} type="submit" disabled={loading}>{loading ? 'Working…' : isSignUp ? 'Create Account' : 'Sign In'}</button>
                <button type="button" onClick={() => setIsSignUp(v => !v)} style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', fontFamily: 'Barlow, sans-serif' }}>
                  {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
                </button>
              </form>
            )}

            {mode === 'code' && !codeSent && (
              <form style={styles.form} onSubmit={handleSendCode}>
                <input style={styles.input} type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
                {error && <div style={styles.error}>{error}</div>}
                <button style={styles.btn} type="submit" disabled={loading}>{loading ? 'Sending…' : 'Email Me a Code'}</button>
              </form>
            )}
            {mode === 'code' && codeSent && (
              <form style={styles.form} onSubmit={handleVerifyCode}>
                <input style={styles.input} type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={e => setCode(e.target.value)} required />
                {error && <div style={styles.error}>{error}</div>}
                <button style={styles.btn} type="submit" disabled={loading}>{loading ? 'Verifying…' : 'Verify Code'}</button>
              </form>
            )}

            {mode === 'link' && (
              <form style={styles.form} onSubmit={handleLink}>
                <input style={styles.input} type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
                {error && <div style={styles.error}>{error}</div>}
                <button style={styles.btn} type="submit" disabled={loading}>{loading ? 'Sending...' : 'Send Magic Link'}</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
