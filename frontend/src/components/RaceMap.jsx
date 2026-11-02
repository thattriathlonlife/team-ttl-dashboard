import { Component, Suspense, lazy, useMemo, useState } from 'react'
import RaceMapLeaflet from './RaceMapLeaflet'

// Code-split (2026-11-01 backlog): the MapLibre GL implementation lives in
// RaceMapGL.jsx and loads on demand, so first paint no longer carries the
// ~1MB GL bundle. Any load/render failure of the GL path falls back to the
// verified Leaflet map. Zero visual change: same component, same props.
const RaceMapGL = lazy(() => import('./RaceMapGL'))

class GLBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFail?.() }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export default function RaceMap(props) {
  const [glFailed, setGlFailed] = useState(false)
  const webglOk = useMemo(() => {
    try {
      const canvas = document.createElement('canvas')
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')))
    } catch { return false }
  }, [])
  if (glFailed || !webglOk) return <RaceMapLeaflet {...props} />
  return (
    <GLBoundary fallback={<RaceMapLeaflet {...props} />} onFail={() => setGlFailed(true)}>
      <Suspense fallback={<div style={{ width: '100%', height: '300px', borderRadius: '16px', background: '#05090e' }} />}>
        <RaceMapGL {...props} onFail={() => setGlFailed(true)} />
      </Suspense>
    </GLBoundary>
  )
}
