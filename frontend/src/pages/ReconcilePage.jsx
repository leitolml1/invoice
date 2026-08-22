import { useState } from 'react'
import { reconcileInvoice } from '../api.js'
import { useI18n } from '../i18n.jsx'
import { useHistory } from '../history.jsx'
import UploadZone from '../components/UploadZone.jsx'
import LoadingState from '../components/LoadingState.jsx'
import ResultPanel from '../components/ResultPanel.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'

export default function ReconcilePage() {
  const { t } = useI18n()
  const { addEntry } = useHistory()
  const [status, setStatus] = useState('idle')
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function handleFileSelected(file) {
    setFileName(file.name)
    setError('')
    setResult(null)
    setStatus('loading')

    try {
      const data = await reconcileInvoice(file)
      setResult(data)
      setStatus('result')
      addEntry(data, file.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorFallback)
      setStatus('error')
    }
  }

  function reset() {
    setStatus('idle')
    setFileName('')
    setResult(null)
    setError('')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{t.pageTitle}</h1>
          <p className="subtitle">{t.subtitle}</p>
        </div>
        <div className="topbar__actions">
          <LanguageSwitch />
          {status !== 'idle' ? (
            <button type="button" className="btn" onClick={reset}>
              {t.newInvoice}
            </button>
          ) : null}
        </div>
      </header>

      <main>
        {status === 'idle' ? (
          <UploadZone onFileSelected={handleFileSelected} />
        ) : null}

        {status === 'loading' ? <LoadingState fileName={fileName} /> : null}

        {status === 'error' ? (
          <section className="error-box" role="alert">
            <h2>{t.errorTitle}</h2>
            <p>{error}</p>
            <p className="muted">{t.errorHint}</p>
            <button type="button" className="btn" onClick={reset}>
              {t.retryUpload}
            </button>
          </section>
        ) : null}

        {status === 'result' && result ? <ResultPanel result={result} /> : null}
      </main>
    </div>
  )
}
