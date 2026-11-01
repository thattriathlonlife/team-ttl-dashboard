// OpenStreetMap embed with one marker per geocoded race. Extracted from
// Home.jsx in the 5-tab reshuffle (2026-10-31): the map's home is the Races
// page; Home keeps only a teaser card that links there.
export default function RaceMap({ races }) {
  const racesWithCoords = races.filter(r => r.latitude && r.longitude)

  if (racesWithCoords.length === 0) {
    return (
      <div style={{
        background: '#161616',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px', height: '340px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '12px',
      }}>
        <div style={{ fontSize: '32px' }}>🗺️</div>
        <div style={{
          fontFamily: 'Barlow Condensed, sans-serif',
          fontSize: '14px', letterSpacing: '2px',
          textTransform: 'uppercase', color: '#555',
        }}>
          No location data for these races
        </div>
      </div>
    )
  }

  const markers = racesWithCoords.map(r => `marker=${r.latitude},${r.longitude}`).join('&')
  const minLat = Math.min(...racesWithCoords.map(r => r.latitude))
  const maxLat = Math.max(...racesWithCoords.map(r => r.latitude))
  const minLon = Math.min(...racesWithCoords.map(r => r.longitude))
  const maxLon = Math.max(...racesWithCoords.map(r => r.longitude))
  const latPad = Math.max((maxLat - minLat) * 0.4, 2)
  const lonPad = Math.max((maxLon - minLon) * 0.4, 3)
  const bbox = `${minLon - lonPad},${minLat - latPad},${maxLon + lonPad},${maxLat + latPad}`
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&${markers}`

  return (
    <div style={{
      borderRadius: '12px', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.08)',
      position: 'relative',
    }}>
      <div style={{
        background: '#161616',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '10px 16px', display: 'flex', gap: '16px', flexWrap: 'wrap',
      }}>
        {racesWithCoords.map(race => (
          <div key={race.id} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '13px', color: '#ccc',
            fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.5px',
          }}>
            <span style={{ color: 'var(--brand)', fontSize: '16px' }}>📍</span>
            <span style={{ fontWeight: 600, color: '#fff' }}>{race.city || race.location}</span>
            <span style={{ color: '#999' }}>— {race.name}</span>
          </div>
        ))}
      </div>
      <iframe
        title="Race locations"
        src={src}
        style={{ width: '100%', height: '320px', border: 'none', display: 'block' }}
        loading="lazy"
      />
      <div style={{
        position: 'absolute', bottom: '8px', right: '8px',
        background: 'rgba(0,0,0,0.6)', borderRadius: '4px',
        padding: '3px 8px', fontSize: '10px', color: '#999',
        fontFamily: 'Barlow, sans-serif',
      }}>
        © OpenStreetMap contributors
      </div>
    </div>
  )
}
