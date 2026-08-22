/**
 * CAPA DE APLANADO. Traduce el resultado interno del motor al contrato plano que
 * consume el frontend.
 *
 * Por que existe: los campos envueltos { valor, confianza, needs_review } son
 * utiles adentro del motor (habilitan las reglas de confianza y la guarda
 * anti-alucinacion) pero el frontend no los sabe leer. En vez de complicar la
 * UI, el backend aplana. Este archivo es el unico lugar donde vive esa
 * traduccion, asi que es el unico que hay que tocar si el contrato cambia.
 *
 * CONTRATO DE SALIDA (compartido con el frontend, ver frontend/src/api.js):
 *
 * {
 *   "factura": {
 *     "proveedor": string,
 *     "fecha": string,
 *     "items": [{ "nombre": string, "cantidad": number, "precio_unitario": number, "total": number }],
 *     "total_factura": number,
 *     "needs_review": boolean
 *   },
 *   "discrepancias": [{
 *     "tipo": string, "campo": string,
 *     "valor_factura": string, "valor_ordenado": string,
 *     "explicacion_legible": string,
 *     "severidad": "baja" | "media" | "alta",
 *     "requiere_revision_manual": boolean
 *   }]
 * }
 */

/**
 * Mapeo de las 5 severidades internas a las 3 que el frontend sabe estilar.
 *
 * `critica` se colapsa en `alta` porque el CSS del frontend no tiene un cuarto
 * nivel. Se pierde el matiz entre "sospecha de fraude / proveedor equivocado"
 * (critica) y "sobreprecio del 9%" (alta): en la UI se ven igual. La severidad
 * interna sin colapsar viaja en `severidad_interna` para quien la quiera usar.
 */
export const MAPA_SEVERIDAD = Object.freeze({
  critica: 'alta',
  alta: 'alta',
  media: 'media',
  baja: 'baja',
  informativa: 'baja'
});

/** Texto que se usa cuando un valor no existe, para no romper el tipo string. */
export const SIN_DATO = 'sin dato';

/**
 * @param {unknown} valor
 * @returns {string}
 */
function aTexto(valor) {
  if (valor === null || valor === undefined || valor === '') return SIN_DATO;
  return String(valor);
}

/**
 * Lee el valor de un campo envuelto, o el valor pelado si ya viene plano.
 * @param {unknown} campo
 * @returns {unknown}
 */
function valorDe(campo) {
  if (campo && typeof campo === 'object' && 'valor' in campo) {
    return /** @type {{valor: unknown}} */ (campo).valor;
  }
  return campo ?? null;
}

/**
 * Aplana una factura normalizada del motor.
 *
 * Nota sobre `cantidad`: si el OCR no pudo leer la cantidad, se devuelve `null`
 * y no 0. El tipo declarado en frontend/src/api.js dice `number`, pero mandar 0
 * seria inventar un dato que no esta en la factura, y eso esta prohibido por
 * diseno. React renderiza `null` como vacio, que es la lectura correcta:
 * "no se pudo leer". El campo needs_review acompania.
 *
 * @param {import('../schema/invoice.js').FacturaNormalizada} factura
 * @returns {{ proveedor: string, fecha: string, items: object[], total_factura: number|null, needs_review: boolean }}
 */
export function aplanarFactura(factura) {
  const items = (factura.items ?? []).map((item) => ({
    nombre: aTexto(valorDe(item.descripcion)),
    cantidad: /** @type {number|null} */ (valorDe(item.cantidad)),
    precio_unitario: /** @type {number|null} */ (valorDe(item.precio_unitario)),
    total: /** @type {number|null} */ (valorDe(item.importe_linea))
  }));

  return {
    proveedor: aTexto(valorDe(factura.proveedor?.nombre)),
    fecha: aTexto(valorDe(factura.fecha_emision)),
    items,
    total_factura: /** @type {number|null} */ (valorDe(factura.totales?.total)),
    needs_review: Boolean(factura.needs_review)
  };
}

/**
 * Aplana una discrepancia interna al contrato del frontend.
 *
 * @param {import('../schema/discrepancy.js').Discrepancia} d
 * @returns {object}
 */
export function aplanarDiscrepancia(d) {
  const severidad = MAPA_SEVERIDAD[d.severidad] ?? 'media';
  return {
    tipo: d.tipo,
    campo: d.campo,
    valor_factura: aTexto(d.valor_factura),
    valor_ordenado: aTexto(d.valor_ordenado),
    explicacion_legible: d.explicacion_legible,
    severidad,
    requiere_revision_manual: Boolean(d.requiere_revision_manual),
    // Extras aditivos: el frontend puede ignorarlos sin romperse.
    severidad_interna: d.severidad,
    id: d.id,
    capa: d.capa,
    sugerencia: d.sugerencia ?? null
  };
}

/**
 * Aplana el resultado completo de una reconciliacion.
 *
 * @param {import('../matching/engine.js').ResultadoReconciliacion} resultado
 * @param {object} [extras] metadata opcional a exponer bajo `meta`
 * @returns {object}
 */
export function aplanarResultado(resultado, extras = {}) {
  return {
    factura: aplanarFactura(resultado.factura),
    discrepancias: (resultado.discrepancias ?? []).map(aplanarDiscrepancia),
    // Aditivo. El contrato minimo son `factura` y `discrepancias`; esto es
    // contexto util para la UI (estado global, monto en disputa, trazabilidad).
    meta: {
      estado: resultado.estado,
      orden_id: resultado.orden_id,
      documento_id: resultado.documento_id,
      moneda: resultado.moneda,
      monto_en_disputa: resultado.resumen?.monto_en_disputa ?? 0,
      total_discrepancias: resultado.resumen?.total_discrepancias ?? 0,
      requiere_revision_manual: resultado.resumen?.requiere_revision_manual ?? false,
      por_severidad: resultado.resumen?.por_severidad ?? null,
      confianza_extraccion: resultado.factura?.confianza_global ?? null,
      ...extras
    }
  };
}
