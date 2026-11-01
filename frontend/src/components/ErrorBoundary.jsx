import { Component } from 'react'

// Containment for render crashes (added 2026-11-01 after two black-screen
// incidents): a throw inside a page or segment must degrade to a small
// card the member can escape from, never a full-app black void. The
// segment-level boundary in Team.jsx keeps the pills alive so the member
// can switch away; this same component wraps the routed page in App.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Kept in the console for diagnosis; the member sees plain language.
    console.error('[ErrorBoundary]', this.props.label || 'app', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    // When the wrapped surface changes (e.g. a different Team segment),
    // give it a fresh chance instead of staying stuck on the error card.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          margin: '1rem 0', padding: '1.1rem 1.2rem', borderRadius: '14px',
          background: '#161616', border: '1px solid rgba(232,115,98,0.45)',
          fontFamily: 'Barlow, sans-serif',
        }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '15px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '6px' }}>
            This section hit a snag
          </div>
          <div style={{ fontSize: '13.5px', color: '#bbb', lineHeight: 1.5, marginBottom: '10px' }}>
            Something in this part of the app failed to load. The rest of the app is fine — switch tabs or reload.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: '12.5px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', background: 'var(--brand)', color: '#08110f', border: 'none', borderRadius: '999px', padding: '7px 16px', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
