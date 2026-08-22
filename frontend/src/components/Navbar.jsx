import { Link, NavLink } from 'react-router-dom'
import { useI18n } from '../i18n.jsx'
import { useHistory } from '../history.jsx'

function navClass({ isActive }) {
  return isActive ? 'navbar__link is-active' : 'navbar__link'
}

export default function Navbar() {
  const { t } = useI18n()
  const { entries } = useHistory()

  return (
    <nav className="navbar" aria-label={t.navMenu}>
      <div className="navbar__inner">
        <Link to="/" className="navbar__brand">
          <span className="navbar__mark" aria-hidden="true">
            ◆
          </span>
          INVOICE
        </Link>

        <ul className="navbar__links">
          <li>
            <NavLink to="/" end className={navClass}>
              {t.navHome}
            </NavLink>
          </li>
          <li>
            <NavLink to="/app" className={navClass}>
              {t.navReconcile}
            </NavLink>
          </li>
          <li>
            <NavLink to="/historial" className={navClass}>
              {t.navHistory}
              {entries.length > 0 ? (
                <span className="navbar__count">{entries.length}</span>
              ) : null}
            </NavLink>
          </li>
          <li>
            <NavLink to="/about" className={navClass}>
              {t.navAbout}
            </NavLink>
          </li>
        </ul>
      </div>
    </nav>
  )
}
