import { useState, useEffect } from 'react'
import LandingPage from './pages/LandingPage.jsx'
import AppPage     from './pages/AppPage.jsx'

const PAGE_KEY = 'mp_current_page'

export default function App() {
  const [page, setPage] = useState(
    () => sessionStorage.getItem(PAGE_KEY) || 'landing'
  )

  useEffect(() => {
    // Push initial state so back button has something to go to
    if (page === 'app') {
      window.history.pushState({ page: 'app' }, '')
    }
  }, [])

  useEffect(() => {
    // Listen for browser back/forward button
    function handlePopState(e) {
      const p = e.state?.page || 'landing'
      sessionStorage.setItem(PAGE_KEY, p)
      setPage(p)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  function navigate(p) {
    sessionStorage.setItem(PAGE_KEY, p)
    if (p === 'app') {
      window.history.pushState({ page: 'app' }, '')
    } else {
      window.history.back()
    }
    setPage(p)
  }

  return page === 'landing'
    ? <LandingPage onEnterApp={() => navigate('app')} />
    : <AppPage     onBack={() => navigate('landing')} />
}