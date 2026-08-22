import { Link } from 'react-router-dom'
import { useI18n } from '../i18n.jsx'
import { useHistory } from '../history.jsx'

export default function HistoryPage() {
  const { t, locale } = useI18n()
  const { entries } = useHistory()

  if (entries.length === 0) {
    return (
      <div className="app">
        <header className="topbar">
          <div>
            <h1>{t.historyTitle}</h1>
            <p className="subtitle">{t.historySubtitle}</p>
          </div>
        </header>

        <main>
          <section className="empty-state">
            <span className="empty-state__icon" aria-hidden="true">
              🗂️
            </span>
            <h2>{t.historyEmptyTitle}</h2>
            <p>{t.historyEmptyBody}</p>
            <Link to="/app" className="btn btn--cta">
              {t.historyEmptyCta}
            </Link>
          </section>
        </main>
      </div>
    )
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp))
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{t.historyTitle}</h1>
          <p className="subtitle">{t.historySubtitle}</p>
        </div>
        <div className="topbar__actions">
          <span className="pill">
            {entries.length} {t.historyCount}
          </span>
        </div>
      </header>

      <main>
        <div className="panel">
          <div className="table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>{t.historyColVendor}</th>
                  <th>{t.historyColDate}</th>
                  <th>{t.historyColDiscrepancies}</th>
                  <th>{t.historyColReview}</th>
                  <th>{t.historyProcessedAt}</th>
                  <th aria-label={t.historyColDetail} />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.result.factura.proveedor}</strong>
                      {entry.fileName ? (
                        <span className="history-table__file">{entry.fileName}</span>
                      ) : null}
                    </td>
                    <td>{entry.result.factura.fecha}</td>
                    <td>{entry.discrepancyCount}</td>
                    <td>
                      <span
                        className={
                          entry.needsManualReview
                            ? 'badge badge--review'
                            : 'badge badge--baja'
                        }
                      >
                        {entry.needsManualReview
                          ? t.historyReviewYes
                          : t.historyReviewNo}
                      </span>
                    </td>
                    <td className="muted">{formatTime(entry.processedAt)}</td>
                    <td>
                      <Link to={`/historial/${entry.id}`} className="btn btn--sm">
                        {t.historyViewDetail}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
