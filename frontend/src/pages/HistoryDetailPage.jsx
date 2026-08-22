import { Link, useParams } from 'react-router-dom'
import { useI18n } from '../i18n.jsx'
import { useHistory } from '../history.jsx'
import ResultPanel from '../components/ResultPanel.jsx'

export default function HistoryDetailPage() {
  const { t } = useI18n()
  const { id } = useParams()
  const { getEntry } = useHistory()
  const entry = getEntry(id)

  if (!entry) {
    return (
      <div className="app">
        <main>
          <section className="empty-state">
            <h2>{t.historyNotFoundTitle}</h2>
            <p>{t.historyNotFoundBody}</p>
            <Link to="/historial" className="btn">
              {t.historyBack}
            </Link>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{t.historyDetailTitle}</h1>
          <p className="subtitle">
            {entry.result.factura.proveedor}
            {entry.fileName ? ` · ${entry.fileName}` : ''}
          </p>
        </div>
        <div className="topbar__actions">
          <Link to="/historial" className="btn">
            {t.historyBack}
          </Link>
        </div>
      </header>

      <main>
        <ResultPanel result={entry.result} />
      </main>
    </div>
  )
}
