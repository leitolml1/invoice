import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import HomePage from './pages/HomePage.jsx'
import ReconcilePage from './pages/ReconcilePage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import HistoryDetailPage from './pages/HistoryDetailPage.jsx'
import AboutPage from './pages/AboutPage.jsx'

function Layout() {
  return (
    <>
      <Navbar />
      <Outlet />
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/app" element={<ReconcilePage />} />
        <Route path="/historial" element={<HistoryPage />} />
        <Route path="/historial/:id" element={<HistoryDetailPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
