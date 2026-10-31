import { setDemoTier } from '../lib/tier'

// Showcase shown in place of a team-only surface when the viewer is not
// entitled (ACCESS-AND-UI-SPEC: show, don't hide). In the POC the demo
// switch stands in for the real entitlement check.
export default function TeamLocked({ feature }) {
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '56px 20px 96px', textAlign: 'center' }}>
      <div style={{ fontSize: 34, marginBottom: 10 }}>🔒</div>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#fff', marginBottom: 8 }}>
        {feature} is for Team TTL members
      </div>
      <p style={{ fontFamily: 'Barlow, sans-serif', fontSize: 15, color: '#999', lineHeight: 1.6, marginBottom: 22 }}>
        Races, the team map, and TTL content are open to everyone. Training challenges,
        partner deals, the gear guide, and team channels live behind team membership —
        that's what makes them worth having.
      </p>
      <a href="https://thattriathlonlife.com" target="_blank" rel="noopener"
        style={{ display: 'inline-block', background: 'var(--brand)', color: '#06282a', borderRadius: 6, padding: '12px 22px', fontFamily: 'Barlow Condensed, sans-serif', fontSize: 15, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', textDecoration: 'none', marginBottom: 14 }}>
        Apply for Team TTL
      </a>
      <div>
        <button onClick={() => setDemoTier('team')}
          style={{ background: 'none', border: 'none', color: '#666', fontSize: 12, cursor: 'pointer', fontFamily: 'Barlow, sans-serif', textDecoration: 'underline' }}>
          Demo: preview the member view
        </button>
      </div>
    </div>
  )
}
