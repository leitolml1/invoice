import { useI18n } from '../i18n.jsx'

export default function DiscrepancyCard({ discrepancia }) {
  const { t } = useI18n()
  const {
    tipo,
    campo,
    valor_factura,
    valor_ordenado,
    explicacion_legible,
    severidad,
    requiere_revision_manual,
  } = discrepancia

  const severityLabel = {
    baja: t.severityLow,
    media: t.severityMedium,
    alta: t.severityHigh,
  }

  return (
    <article className={`disc-card disc-card--${severidad}`}>
      <header className="disc-card__header">
        <span className={`badge badge--${severidad}`}>
          {severityLabel[severidad] ?? severidad}
        </span>
        {requiere_revision_manual ? (
          <span className="badge badge--review">{t.reviewBanner}</span>
        ) : null}
      </header>

      <p className="disc-card__campo">
        <span className="muted">{t.field}</span> {campo}
        <span className="disc-card__tipo">{tipo}</span>
      </p>

      <div className="disc-card__values">
        <div>
          <span className="muted">{t.invoiceValue}</span>
          <strong>{valor_factura}</strong>
        </div>
        <div className="disc-card__vs" aria-hidden="true">
          vs
        </div>
        <div>
          <span className="muted">{t.expectedValue}</span>
          <strong>{valor_ordenado}</strong>
        </div>
      </div>

      <p className="disc-card__explain">{explicacion_legible}</p>
    </article>
  )
}
