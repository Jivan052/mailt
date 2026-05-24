import { useState } from 'react'
import LandingView from './pages/LandingPage.jsx'
import AppPage     from './pages/AppPage.jsx'

const PAGE_KEY = 'mp_current_page'

export default function App() {
  const [page, setPage] = useState(
    () => sessionStorage.getItem(PAGE_KEY) || 'landing'
  )

  function navigate(p) {
    sessionStorage.setItem(PAGE_KEY, p)
    setPage(p)
  }

  return page === 'landing'
    ? <LandingView onEnterApp={() => navigate('app')} />
    : <AppPage     onBack={() => navigate('landing')} />
}