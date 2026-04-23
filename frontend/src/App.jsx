import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import MyRaces from './pages/MyRaces'
import ProfileSettings from './pages/ProfileSettings'
import CompleteProfile from './pages/CompleteProfile'
import Layout from './components/Layout'

function AppRoutes({ session, profile, setProfile }) {
  const navigate = useNavigate()
  const [showProfile, setShowProfile] = useState(false)

  const handleProfileComplete = async () => {
    // Reload profile after completion
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    if (data) setProfile(data)
    setShowProfile(false)
  }

  if (showProfile) {
    return (
      <ProfileSettings
        session={session}
        onBack={() => {
          // Reload profile on back
          supabase.from('profiles').select('*').eq('id', session.user.id).single()
            .then(({ data }) => { if (data) setProfile(data) })
          setShowProfile(false)
        }}
      />
    )
  }

  return (
    <Layout session={session} profile={profile} onNavigateProfile={() => setShowProfile(true)}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" />} />
        <Route path="/" element={<Home session={session} />} />
        <Route path="/races" element={<Dashboard session={session} />} />
        <Route path="/my-races" element={<MyRaces session={session} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasProfile, setHasProfile] = useState(null)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) checkProfile(session.user.id)
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) checkProfile(session.user.id)
      else { setHasProfile(null); setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function checkProfile(userId) {
    const { data } = await supabase
      .from('profiles').select('*').eq('id', userId).single()
    const nameIsReal = data?.full_name && !data.full_name.includes('@') && data.full_name.length > 2
    setHasProfile(!!(data && nameIsReal))
    if (data) setProfile(data)
    setLoading(false)
  }

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d' }}>
      <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 18, letterSpacing: 3, color: '#aaa', textTransform: 'uppercase' }}>Loading...</div>
    </div>
  )

  if (!session) return <Login />

  if (!hasProfile) {
    return (
      <CompleteProfile
        session={session}
        onComplete={async () => {
          await checkProfile(session.user.id)
        }}
      />
    )
  }

  return (
    <BrowserRouter>
      <AppRoutes session={session} profile={profile} setProfile={setProfile} />
    </BrowserRouter>
  )
}
