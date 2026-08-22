import { Link } from 'react-router-dom'
import { useI18n } from '../i18n.jsx'
import LanguageSwitch from '../components/LanguageSwitch.jsx'

export default function HomePage() {
  const { t } = useI18n()

  const benefits = [
    { icon: '🔒', title: t.benefit1Title, body: t.benefit1Body },
    { icon: '💸', title: t.benefit2Title, body: t.benefit2Body },
    { icon: '✈️', title: t.benefit3Title, body: t.benefit3Body },
    { icon: '💬', title: t.benefit4Title, body: t.benefit4Body },
  ]

  const steps = [
    { title: t.howStep1Title, body: t.howStep1Body },
    { title: t.howStep2Title, body: t.howStep2Body },
    { title: t.howStep3Title, body: t.howStep3Body },
  ]

  return (
    <>
      {/*
        El hero vive fuera de .landing porque necesita ocupar el ancho
        completo de la ventana, y .landing__inner esta limitado a 1120px.
      */}
      <section className="hero">
        <div className="hero__inner">
          <div className="hero__lang">
            <LanguageSwitch />
          </div>
          <span className="hero__badge">{t.heroBadge}</span>
          <h1 className="hero__title">INVOICE</h1>
          <p className="hero__tagline">{t.heroTagline}</p>
          <p className="hero__body">{t.heroBody}</p>
          <div className="hero__actions">
            <Link to="/app" className="btn btn--cta">
              {t.heroCta}
            </Link>
            <a href="#como-funciona" className="btn btn--ghost">
              {t.heroSecondaryCta}
            </a>
          </div>
        </div>
      </section>

      {/*
        .landing es full width y opaco: es lo que tapa al hero mientras
        este queda pinneado y se achica. .landing__inner mantiene la
        columna de contenido centrada.
      */}
      <div className="landing">
        <div className="landing__inner">
          <section className="section">
            <h2 className="section__title">{t.benefitsTitle}</h2>
            <div className="benefit-grid">
              {benefits.map((benefit) => (
                <article className="benefit-card" key={benefit.title}>
                  <span className="benefit-card__icon" aria-hidden="true">
                    {benefit.icon}
                  </span>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="section" id="como-funciona">
            <h2 className="section__title">{t.howTitle}</h2>
            <ol className="steps">
              {steps.map((step, index) => (
                <li className="step" key={step.title}>
                  <span className="step__num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <footer className="landing-footer">
            <p>
              <strong>INVOICE</strong> · {t.footerTagline}
            </p>
            <Link to="/about">{t.footerAbout}</Link>
          </footer>
        </div>
      </div>
    </>
  )
}
