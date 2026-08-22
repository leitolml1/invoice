import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/**
 * Historial en memoria de la sesión actual.
 * No hay persistencia: al recargar la página el historial arranca vacío.
 *
 * @typedef {Object} HistoryEntry
 * @property {string} id
 * @property {string} fileName
 * @property {number} processedAt
 * @property {number} discrepancyCount
 * @property {boolean} needsManualReview
 * @property {import('./api.js').ReconcileResult} result
 */

const HistoryContext = createContext(null)

let counter = 0

function nextId() {
  counter += 1
  return `entry-${counter}`
}

export function HistoryProvider({ children }) {
  const [entries, setEntries] = useState(/** @type {HistoryEntry[]} */ ([]))

  const addEntry = useCallback((result, fileName = '') => {
    if (!result || !result.factura) return null

    const discrepancias = result.discrepancias ?? []
    const entry = {
      id: nextId(),
      fileName,
      processedAt: Date.now(),
      discrepancyCount: discrepancias.length,
      needsManualReview:
        Boolean(result.factura.needs_review) ||
        discrepancias.some((item) => item.requiere_revision_manual),
      result,
    }

    setEntries((prev) => [entry, ...prev])
    return entry.id
  }, [])

  const value = useMemo(
    () => ({
      entries,
      addEntry,
      getEntry: (id) => entries.find((entry) => entry.id === id) ?? null,
    }),
    [entries, addEntry],
  )

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>
}

export function useHistory() {
  const ctx = useContext(HistoryContext)
  if (!ctx) throw new Error('useHistory must be used inside HistoryProvider')
  return ctx
}
