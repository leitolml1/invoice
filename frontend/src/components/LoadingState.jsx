import { useI18n } from '../i18n.jsx'

export default function LoadingState({ fileName }) {
  const { t } = useI18n()

  return (
    <section className="loading" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <h2>{t.loadingTitle}</h2>
      <p>{t.loadingBody}</p>
      {fileName ? <p className="loading__file">{fileName}</p> : null}
    </section>
  )
}
