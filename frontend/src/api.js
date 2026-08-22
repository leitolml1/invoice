/**
 * @typedef {Object} FacturaItem
 * @property {string} nombre
 * @property {number} cantidad
 * @property {number} precio_unitario
 * @property {number} total
 */

/**
 * @typedef {Object} Factura
 * @property {string} proveedor
 * @property {string} fecha
 * @property {FacturaItem[]} items
 * @property {number} total_factura
 * @property {boolean} needs_review
 */

/**
 * @typedef {Object} Discrepancia
 * @property {string} tipo
 * @property {string} campo
 * @property {string} valor_factura
 * @property {string} valor_ordenado
 * @property {string} explicacion_legible
 * @property {'baja' | 'media' | 'alta'} severidad
 * @property {boolean} requiere_revision_manual
 */

/**
 * @typedef {Object} ReconcileResult
 * @property {Factura} factura
 * @property {Discrepancia[]} discrepancias
 */

/**
 * Envía la factura al pipeline local (Persona A + Persona B).
 * @param {File} file
 * @returns {Promise<ReconcileResult>}
 */
export async function reconcileInvoice(file) {
  const formData = new FormData()
  formData.append('factura', file)

  const response = await fetch('/reconcile', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const detalle = await response.text()
    throw new Error(detalle || `El servidor respondió ${response.status}`)
  }

  return response.json()
}
