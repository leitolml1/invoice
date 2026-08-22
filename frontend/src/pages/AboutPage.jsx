import { Link } from 'react-router-dom'
import { useI18n } from '../i18n.jsx'

export default function AboutPage() {
  const { t } = useI18n()

  const sections = [
    { title: t.aboutQvacTitle, body: t.aboutQvacBody },
    { title: t.aboutStackTitle, body: t.aboutStackBody },
    { title: t.aboutStateTitle, body: t.aboutStateBody },
    { title: t.aboutWhyTitle, body: t.aboutWhyBody },
    { title: t.aboutLimitsTitle, body: t.aboutLimitsBody },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{t.aboutTitle}</h1>
          <p className="subtitle">{t.aboutIntro}</p>
        </div>
      </header>

      <main className="prose">
        {sections.map((section) => (
          <article className="panel prose__block" key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}

        <Link to="/app" className="btn btn--cta">
          {t.aboutCta}
        </Link>
      </main>
    </div>
  )
}
