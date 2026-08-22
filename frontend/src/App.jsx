import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import HomePage from './pages/HomePage.jsx'
import ReconcilePage from './pages/ReconcilePage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import HistoryDetailPage from './pages/HistoryDetailPage.jsx'
import AboutPage from './pages/AboutPage.jsx'

function Layout() {
  const location = useLocation()

  return (
    <>
      <Navbar />
      {/*
        La `key` con el pathname hace que React descarte y vuelva a montar
        este contenedor en cada cambio de ruta. Es lo que reinicia la
        animación CSS de entrada: sin la key, el @keyframes correría solo
        en la carga inicial.

        El Navbar queda afuera a propósito, para que no parpadee en cada
        navegación. Los providers de i18n e historial viven en main.tsx,
        por encima de App, así que este remount no les toca el estado.
      */}
      <div className="route-fade" key={location.pathname}>
        <Outlet />
      </div>
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
