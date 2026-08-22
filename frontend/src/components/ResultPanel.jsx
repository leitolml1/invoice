import DiscrepancyCard from './DiscrepancyCard.jsx'
import { useI18n } from '../i18n.jsx'

export default function ResultPanel({ result }) {
  const { t, locale } = useI18n()
  const { factura, discrepancias } = result
  const hayRevisionManual =
    factura.needs_review ||
    discrepancias.some((item) => item.requiere_revision_manual)

  const sinDiscrepancias = discrepancias.length === 0

  function formatMoney(value) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2,
    }).format(value)
  }

  return (
    <section className="result">
      {hayRevisionManual ? (
        <div className="review-banner" role="alert">
          {t.reviewBanner}
          <span>{t.reviewBannerHint}</span>
        </div>
      ) : (
        <div className="ok-banner" role="status">
          {t.okBanner}
          <span>{t.okBannerHint}</span>
        </div>
      )}

      <div className="result-grid">
        <article className="panel">
          <h2>{t.extractedTitle}</h2>
          <dl className="meta">
            <div>
              <dt>{t.vendor}</dt>
              <dd>{factura.proveedor}</dd>
            </div>
            <div>
              <dt>{t.date}</dt>
              <dd>{factura.fecha}</dd>
            </div>
            <div>
              <dt>{t.invoiceTotal}</dt>
              <dd className="meta__total">{formatMoney(factura.total_factura)}</dd>
            </div>
          </dl>

          <h3 className="items-title">{t.items}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.qty}</th>
                  <th>{t.unitPrice}</th>
                  <th>{t.total}</th>
                </tr>
              </thead>
              <tbody>
                {factura.items.map((item, index) => (
                  <tr key={`${item.nombre}-${index}`}>
                    <td>{item.nombre}</td>
                    <td>{item.cantidad}</td>
                    <td>{formatMoney(item.precio_unitario)}</td>
                    <td>{formatMoney(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h2>{t.discrepancies}</h2>
          {sinDiscrepancias ? (
            <p className="empty-disc">{t.noDiscrepancies}</p>
          ) : (
            <div className="disc-list">
              {discrepancias.map((discrepancia, index) => (
                <DiscrepancyCard
                  key={`${discrepancia.campo}-${index}`}
                  discrepancia={discrepancia}
                />
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
