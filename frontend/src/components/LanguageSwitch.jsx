import { useI18n } from '../i18n.jsx'

export default function LanguageSwitch() {
  const { lang, setLang, t } = useI18n()

  return (
    <div className="lang-switch" role="group" aria-label={t.langSwitch}>
      <button
        type="button"
        className={lang === 'es' ? 'lang-switch__btn is-active' : 'lang-switch__btn'}
        onClick={() => setLang('es')}
        aria-pressed={lang === 'es'}
      >
        {t.langEs}
      </button>
      <button
        type="button"
        className={lang === 'en' ? 'lang-switch__btn is-active' : 'lang-switch__btn'}
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
      >
        {t.langEn}
      </button>
    </div>
  )
}
