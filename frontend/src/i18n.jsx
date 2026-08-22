import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export const LANGS = ['es', 'en']
const STORAGE_KEY = 'invoice-lang'

const messages = {
  es: {
    pageTitle: 'Factura vs. orden de compra',
    subtitle: 'Reconciliación local. El resultado se entiende de un vistazo.',
    newInvoice: 'Nueva factura',
    langEs: 'ES',
    langEn: 'EN',
    langSwitch: 'Idioma',
    uploadTitle: 'Subí la factura',
    uploadHint:
      'Arrastrá un PDF o una imagen, o hacé clic para elegir el archivo.',
    uploadMeta: 'Procesamiento 100% local · sin cloud',
    loadingTitle: 'Procesando localmente...',
    loadingBody:
      'Extrayendo datos de la factura y comparándolos con la orden de compra. Esto puede tardar unos segundos.',
    errorTitle: 'No se pudo completar la reconciliación',
    errorFallback: 'No se pudo reconciliar la factura.',
    errorHint:
      'Confirmá que el servidor local esté corriendo (`npm run server`) y volvé a intentar.',
    retryUpload: 'Volver a subir',
    reviewBanner: 'Revisar manualmente',
    reviewBannerHint: 'Hay diferencias que no se pueden aprobar en automático.',
    okBanner: 'Sin revisión manual',
    okBannerHint: 'No hay discrepancias que exijan intervención.',
    extractedTitle: 'Datos extraídos de la factura',
    vendor: 'Proveedor',
    date: 'Fecha',
    invoiceTotal: 'Total factura',
    items: 'Ítems',
    name: 'Nombre',
    qty: 'Cant.',
    qtyUnknown: 'No se pudo leer la cantidad en la factura',
    unitPrice: 'P. unitario',
    total: 'Total',
    discrepancies: 'Discrepancias',
    noDiscrepancies:
      'No se encontraron discrepancias entre la factura y la orden de compra.',
    severityLow: 'Baja',
    severityMedium: 'Media',
    severityHigh: 'Alta',
    field: 'Campo',
    invoiceValue: 'Valor factura',
    expectedValue: 'Valor esperado',

    navHome: 'Inicio',
    navReconcile: 'Reconciliar',
    navHistory: 'Historial',
    navAbout: 'Acerca de',
    navMenu: 'Navegación principal',

    heroTagline:
      'Reconciliación de facturas 100% local — tus documentos financieros nunca salen de tu máquina.',
    heroBody:
      'Subí una factura, compará contra la orden de compra y recibí cada diferencia explicada en lenguaje claro. Sin nube, sin API keys.',
    heroCta: 'Reconciliar una factura',
    heroSecondaryCta: 'Cómo funciona',
    heroBadge: 'Inferencia on-device',

    benefitsTitle: 'Por qué local',
    benefit1Title: '100% privado',
    benefit1Body: 'Nada se sube a la nube: todo corre en tu hardware.',
    benefit2Title: 'Sin costo de inferencia',
    benefit2Body: 'No pagás por llamadas a una API externa.',
    benefit3Title: 'Funciona offline',
    benefit3Body: 'No depende de tener conexión a internet.',
    benefit4Title: 'Explica cada discrepancia',
    benefit4Body: 'No solo marca el error: te dice por qué aparece.',

    howTitle: 'Cómo funciona',
    howStep1Title: 'Subís la factura',
    howStep1Body: 'Arrastrá un PDF o una imagen en la pantalla de reconciliación.',
    howStep2Title: 'Se compara localmente',
    howStep2Body:
      'Los datos se extraen y se comparan con la orden de compra en tu propia máquina.',
    howStep3Title: 'Ves el resultado explicado',
    howStep3Body:
      'Cada diferencia queda explicada y lo que necesita revisión manual aparece marcado.',

    footerTagline: 'Reconciliación de facturas con IA on-device.',
    footerAbout: 'Acerca del proyecto',

    historyTitle: 'Historial de la sesión',
    historySubtitle:
      'Facturas procesadas desde que abriste la app. Se borra al recargar la página.',
    historyCount: 'facturas procesadas',
    historyEmptyTitle: 'Todavía no procesaste ninguna factura',
    historyEmptyBody:
      'Cuando reconcilies una factura, la vas a ver acá con su resumen y el detalle completo.',
    historyEmptyCta: 'Ir a reconciliar',
    historyColVendor: 'Proveedor',
    historyColDate: 'Fecha factura',
    historyColDiscrepancies: 'Discrepancias',
    historyColReview: 'Revisión manual',
    historyColDetail: 'Detalle',
    historyViewDetail: 'Ver detalle',
    historyReviewYes: 'Requerida',
    historyReviewNo: 'No requerida',
    historyProcessedAt: 'Procesada',
    historyBack: 'Volver al historial',
    historyDetailTitle: 'Detalle de la factura',
    historyNotFoundTitle: 'Esa factura no está en el historial',
    historyNotFoundBody:
      'El historial vive solo en memoria de la sesión, así que se pierde al recargar la página.',

    aboutTitle: 'Acerca de INVOICE',
    aboutIntro:
      'INVOICE reconcilia una factura contra su orden de compra y explica cada diferencia encontrada. Todo el procesamiento ocurre en la máquina que corre la app.',
    aboutQvacTitle: 'Qué es QVAC y por qué lo usamos',
    aboutQvacBody:
      'QVAC es el runtime que permite ejecutar modelos de IA directamente en el dispositivo, sin servicios externos. Al no haber llamadas a una API remota, no hay API keys que administrar, no hay costo por token y los datos de la factura nunca viajan por la red.',
    aboutStackTitle: 'Qué corre local y qué no',
    aboutStackBody:
      'Todo corre local. El frontend es React + Vite y habla con un endpoint HTTP en 127.0.0.1 (POST /reconcile) que hace la extracción y la comparación en el mismo equipo. No hay servicios de terceros en el camino: la app no envía la factura a ningún host externo.',
    aboutStateTitle: 'Estado actual del proyecto',
    aboutStateBody:
      'Esta interfaz está completa: subida de archivo, estados de carga y error, resultado explicado e historial de la sesión. El endpoint /reconcile que viene en el repo es un stub de desarrollo que devuelve un caso de ejemplo con el contrato final, para poder trabajar el frontend en paralelo. El pipeline de inferencia se conecta en ese mismo endpoint sin tocar la UI.',
    aboutWhyTitle: 'Por qué facturas es un buen caso para IA on-device',
    aboutWhyBody:
      'Una factura expone proveedores, precios, volúmenes y condiciones comerciales. Es información financiera sensible que muchas empresas no pueden (ni deberían) mandar a un servicio de terceros para que la procese. Ejecutar el modelo en la propia máquina resuelve el problema de raíz: el documento no sale del perímetro, y el equipo de finanzas igual se queda con la parte útil, la explicación de cada discrepancia y la marca de lo que necesita revisión humana.',
    aboutLimitsTitle: 'Límites que conviene saber',
    aboutLimitsBody:
      'El historial es solo de la sesión en curso: no hay base de datos ni persistencia en disco, y se vacía al recargar. La app no aprueba ni rechaza facturas por sí sola; marca lo que necesita revisión manual y deja la decisión en manos de una persona.',
    aboutCta: 'Probar la reconciliación',
  },
  en: {
    pageTitle: 'Invoice vs. purchase order',
    subtitle: 'Local reconciliation. The result is clear at a glance.',
    newInvoice: 'New invoice',
    langEs: 'ES',
    langEn: 'EN',
    langSwitch: 'Language',
    uploadTitle: 'Upload the invoice',
    uploadHint: 'Drop a PDF or image, or click to choose a file.',
    uploadMeta: '100% local processing · no cloud',
    loadingTitle: 'Processing locally...',
    loadingBody:
      'Extracting invoice data and matching it against the purchase order. This may take a few seconds.',
    errorTitle: 'Reconciliation could not be completed',
    errorFallback: 'Could not reconcile the invoice.',
    errorHint:
      'Make sure the local server is running (`npm run server`) and try again.',
    retryUpload: 'Upload again',
    reviewBanner: 'Review manually',
    reviewBannerHint: 'There are differences that cannot be auto-approved.',
    okBanner: 'No manual review',
    okBannerHint: 'No discrepancies require intervention.',
    extractedTitle: 'Extracted invoice data',
    vendor: 'Vendor',
    date: 'Date',
    invoiceTotal: 'Invoice total',
    items: 'Items',
    name: 'Name',
    qty: 'Qty',
    qtyUnknown: 'Quantity could not be read from the invoice',
    unitPrice: 'Unit price',
    total: 'Total',
    discrepancies: 'Discrepancies',
    noDiscrepancies:
      'No discrepancies were found between the invoice and the purchase order.',
    severityLow: 'Low',
    severityMedium: 'Medium',
    severityHigh: 'High',
    field: 'Field',
    invoiceValue: 'Invoice value',
    expectedValue: 'Expected value',

    navHome: 'Home',
    navReconcile: 'Reconcile',
    navHistory: 'History',
    navAbout: 'About',
    navMenu: 'Main navigation',

    heroTagline:
      '100% local invoice reconciliation — your financial documents never leave your machine.',
    heroBody:
      'Upload an invoice, match it against the purchase order, and get every difference explained in plain language. No cloud, no API keys.',
    heroCta: 'Reconcile an invoice',
    heroSecondaryCta: 'How it works',
    heroBadge: 'On-device inference',

    benefitsTitle: 'Why local',
    benefit1Title: '100% private',
    benefit1Body: 'Nothing is uploaded to the cloud: everything runs on your hardware.',
    benefit2Title: 'No inference cost',
    benefit2Body: 'You never pay for calls to an external API.',
    benefit3Title: 'Works offline',
    benefit3Body: 'It does not depend on an internet connection.',
    benefit4Title: 'Explains every discrepancy',
    benefit4Body: 'It does not just flag an error: it tells you why it showed up.',

    howTitle: 'How it works',
    howStep1Title: 'You upload the invoice',
    howStep1Body: 'Drop a PDF or an image on the reconciliation screen.',
    howStep2Title: 'It is compared locally',
    howStep2Body:
      'Data is extracted and matched against the purchase order on your own machine.',
    howStep3Title: 'You see the explained result',
    howStep3Body:
      'Every difference comes with an explanation, and anything needing manual review is flagged.',

    footerTagline: 'Invoice reconciliation with on-device AI.',
    footerAbout: 'About the project',

    historyTitle: 'Session history',
    historySubtitle:
      'Invoices processed since you opened the app. It is cleared on reload.',
    historyCount: 'invoices processed',
    historyEmptyTitle: 'No invoices processed yet',
    historyEmptyBody:
      'Once you reconcile an invoice, it will show up here with its summary and full detail.',
    historyEmptyCta: 'Go reconcile one',
    historyColVendor: 'Vendor',
    historyColDate: 'Invoice date',
    historyColDiscrepancies: 'Discrepancies',
    historyColReview: 'Manual review',
    historyColDetail: 'Detail',
    historyViewDetail: 'View detail',
    historyReviewYes: 'Required',
    historyReviewNo: 'Not required',
    historyProcessedAt: 'Processed',
    historyBack: 'Back to history',
    historyDetailTitle: 'Invoice detail',
    historyNotFoundTitle: 'That invoice is not in the history',
    historyNotFoundBody:
      'History lives only in session memory, so it is lost when the page reloads.',

    aboutTitle: 'About INVOICE',
    aboutIntro:
      'INVOICE reconciles an invoice against its purchase order and explains every difference it finds. All processing happens on the machine running the app.',
    aboutQvacTitle: 'What QVAC is and why we use it',
    aboutQvacBody:
      'QVAC is the runtime that lets AI models run directly on the device, with no external services. With no remote API calls there are no API keys to manage, no per-token cost, and invoice data never travels over the network.',
    aboutStackTitle: 'What runs locally and what does not',
    aboutStackBody:
      'Everything runs locally. The frontend is React + Vite and talks to an HTTP endpoint on 127.0.0.1 (POST /reconcile) that performs extraction and comparison on the same box. There are no third-party services in the path: the app never sends the invoice to an external host.',
    aboutStateTitle: 'Current project status',
    aboutStateBody:
      'This interface is complete: file upload, loading and error states, explained results, and session history. The /reconcile endpoint shipped in the repo is a development stub that returns a sample case using the final contract, so the frontend could be built in parallel. The inference pipeline plugs into that same endpoint without touching the UI.',
    aboutWhyTitle: 'Why invoices are a good fit for on-device AI',
    aboutWhyBody:
      'An invoice exposes vendors, prices, volumes, and commercial terms. That is sensitive financial information many companies cannot (and should not) hand to a third-party service for processing. Running the model on the machine itself solves that at the root: the document never leaves the perimeter, and the finance team still gets the useful part, an explanation for each discrepancy and a flag on whatever needs a human.',
    aboutLimitsTitle: 'Limits worth knowing',
    aboutLimitsBody:
      'History covers the current session only: there is no database or on-disk persistence, and it empties on reload. The app does not approve or reject invoices on its own; it flags what needs manual review and leaves the decision to a person.',
    aboutCta: 'Try the reconciliation',
  },
}

const I18nContext = createContext(null)

function readStoredLang() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'es') return stored
  return 'es'
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(readStoredLang)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: messages[lang],
      locale: lang === 'en' ? 'en-US' : 'es-AR',
    }),
    [lang],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
