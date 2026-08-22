/**
 * SALIDA: Discrepancia.
 *
 * CONTRATO CON PERSONA C (UI). Estas 7 claves estan garantizadas en toda
 * discrepancia y no cambian sin avisar:
 *
 *   tipo                      -> uno de TIPOS_DISCREPANCIA
 *   campo                     -> ruta del campo afectado (ej. "totales.total", "items[2].cantidad")
 *   valor_factura             -> string | number | null
 *   valor_ordenado            -> string | number | null
 *   explicacion_legible       -> texto en espaniol, listo para mostrar a un humano
 *   severidad                 -> critica | alta | media | baja | informativa
 *   requiere_revision_manual  -> boolean
 *
 * Ademas se agregan campos auxiliares (id, capa, confianza, delta, contexto,
 * sugerencia). Son aditivos: la UI puede ignorarlos sin romperse.
 */

/** Catalogo cerrado de tipos de discrepancia. */
export const TIPOS_DISCREPANCIA = Object.freeze({
  // --- Identidad del proveedor / documento ---
  SIN_ORDEN_COINCIDENTE: 'SIN_ORDEN_COINCIDENTE',
  PROVEEDOR_DISTINTO: 'PROVEEDOR_DISTINTO',
  PROVEEDOR_VARIANTE_NOMBRE: 'PROVEEDOR_VARIANTE_NOMBRE',
  PROVEEDOR_REQUIERE_VERIFICACION: 'PROVEEDOR_REQUIERE_VERIFICACION',
  IDENTIFICACION_FISCAL_NO_COINCIDE: 'IDENTIFICACION_FISCAL_NO_COINCIDE',
  OC_REFERENCIA_NO_COINCIDE: 'OC_REFERENCIA_NO_COINCIDE',
  MONEDA_DISTINTA: 'MONEDA_DISTINTA',

  // --- Fechas ---
  FECHA_FACTURA_ANTERIOR_A_ORDEN: 'FECHA_FACTURA_ANTERIOR_A_ORDEN',
  FECHA_FUERA_DE_RANGO: 'FECHA_FUERA_DE_RANGO',
  FECHA_AMBIGUA: 'FECHA_AMBIGUA',

  // --- Totales ---
  TOTAL_NO_COINCIDE: 'TOTAL_NO_COINCIDE',
  SUBTOTAL_NO_COINCIDE: 'SUBTOTAL_NO_COINCIDE',
  IMPUESTOS_NO_COINCIDEN: 'IMPUESTOS_NO_COINCIDEN',
  TOTAL_INCONSISTENTE: 'TOTAL_INCONSISTENTE',
  SUMA_LINEAS_NO_COINCIDE_SUBTOTAL: 'SUMA_LINEAS_NO_COINCIDE_SUBTOTAL',

  // --- Nivel de linea ---
  CANTIDAD_NO_COINCIDE: 'CANTIDAD_NO_COINCIDE',
  PRECIO_UNITARIO_NO_COINCIDE: 'PRECIO_UNITARIO_NO_COINCIDE',
  IMPORTE_LINEA_INCONSISTENTE: 'IMPORTE_LINEA_INCONSISTENTE',
  UNIDAD_DISTINTA: 'UNIDAD_DISTINTA',
  ITEM_NO_EN_ORDEN: 'ITEM_NO_EN_ORDEN',
  ITEM_FALTANTE_EN_FACTURA: 'ITEM_FALTANTE_EN_FACTURA',
  ITEM_DUPLICADO: 'ITEM_DUPLICADO',
  ITEM_REQUIERE_VERIFICACION: 'ITEM_REQUIERE_VERIFICACION',

  // --- Calidad de la extraccion (OCR) ---
  CAMPO_ILEGIBLE: 'CAMPO_ILEGIBLE',
  BAJA_CONFIANZA_OCR: 'BAJA_CONFIANZA_OCR'
});

/** Severidades, de mayor a menor. */
export const SEVERIDADES = Object.freeze({
  CRITICA: 'critica',
  ALTA: 'alta',
  MEDIA: 'media',
  BAJA: 'baja',
  INFORMATIVA: 'informativa'
});

/** Orden para comparar severidades. Mayor numero = mas grave. */
export const PESO_SEVERIDAD = Object.freeze({
  informativa: 0,
  baja: 1,
  media: 2,
  alta: 3,
  critica: 4
});

/** Capa que produjo la discrepancia. */
export const CAPAS = Object.freeze({
  DETERMINISTICA: 'capa1_reglas',
  SEMANTICA: 'capa2_ia',
  SIN_RESOLVER: 'capa1_sin_resolver'
});

/** Estados posibles de una reconciliacion. */
export const ESTADOS_RECONCILIACION = Object.freeze({
  APROBADO: 'aprobado',
  APROBADO_CON_OBSERVACIONES: 'aprobado_con_observaciones',
  REQUIERE_REVISION: 'requiere_revision',
  RECHAZADO: 'rechazado'
});

/**
 * @typedef {object} Discrepancia
 * @property {string} id identificador estable dentro del resultado
 * @property {string} tipo uno de TIPOS_DISCREPANCIA
 * @property {string} campo ruta del campo afectado
 * @property {string|number|null} valor_factura
 * @property {string|number|null} valor_ordenado
 * @property {string} explicacion_legible
 * @property {'critica'|'alta'|'media'|'baja'|'informativa'} severidad
 * @property {boolean} requiere_revision_manual
 * @property {string} capa capa que la genero
 * @property {number} confianza confianza del motor en esta deteccion (0..1)
 * @property {number|null} delta diferencia numerica factura - ordenado, si aplica
 * @property {string|null} sugerencia accion sugerida / hipotesis de causa
 * @property {Record<string, unknown>} contexto datos extra para la UI
 */

let contador = 0;

/** Reinicia el contador de ids (usado al comenzar cada reconciliacion). */
export function reiniciarContadorIds() {
  contador = 0;
}

/**
 * Fabrica de discrepancias. Garantiza el contrato y aplica reglas transversales
 * de `requiere_revision_manual`.
 *
 * @param {object} params
 * @param {string} params.tipo
 * @param {string} params.campo
 * @param {string|number|null} [params.valor_factura]
 * @param {string|number|null} [params.valor_ordenado]
 * @param {string} params.explicacion_legible
 * @param {string} params.severidad
 * @param {boolean} [params.requiere_revision_manual]
 * @param {string} [params.capa]
 * @param {number} [params.confianza]
 * @param {number|null} [params.delta]
 * @param {string|null} [params.sugerencia]
 * @param {Record<string, unknown>} [params.contexto]
 * @returns {Discrepancia}
 */
export function crearDiscrepancia(params) {
  if (!TIPOS_DISCREPANCIA[params.tipo]) {
    throw new Error(`crearDiscrepancia: tipo desconocido "${params.tipo}"`);
  }
  if (!PESO_SEVERIDAD[params.severidad] && params.severidad !== SEVERIDADES.INFORMATIVA) {
    throw new Error(`crearDiscrepancia: severidad desconocida "${params.severidad}"`);
  }

  const capa = params.capa ?? CAPAS.DETERMINISTICA;
  const severidad = /** @type {Discrepancia['severidad']} */ (params.severidad);

  // Reglas transversales: se pide revision humana si es grave, si la decidio la
  // IA (nunca confiamos ciego en Capa 2), o si quedo sin resolver.
  const revisionForzada =
    PESO_SEVERIDAD[severidad] >= PESO_SEVERIDAD.alta ||
    capa === CAPAS.SEMANTICA ||
    capa === CAPAS.SIN_RESOLVER;

  contador += 1;
  return {
    id: `d${String(contador).padStart(3, '0')}`,
    tipo: params.tipo,
    campo: params.campo,
    valor_factura: params.valor_factura ?? null,
    valor_ordenado: params.valor_ordenado ?? null,
    explicacion_legible: params.explicacion_legible,
    severidad,
    requiere_revision_manual: params.requiere_revision_manual ?? revisionForzada,
    capa,
    confianza: params.confianza ?? 1,
    delta: params.delta ?? null,
    sugerencia: params.sugerencia ?? null,
    contexto: params.contexto ?? {}
  };
}

/**
 * Severidad segun la magnitud relativa de un desvio monetario.
 * @param {number} delta
 * @param {number} base valor ordenado
 * @param {{ media_hasta: number, alta_hasta: number }} cortes
 * @returns {string}
 */
export function severidadPorMagnitud(delta, base, cortes) {
  if (delta === 0) return SEVERIDADES.INFORMATIVA;
  const rel = base === 0 ? 1 : Math.abs(delta) / Math.abs(base);
  if (rel <= cortes.media_hasta) return SEVERIDADES.MEDIA;
  if (rel <= cortes.alta_hasta) return SEVERIDADES.ALTA;
  return SEVERIDADES.CRITICA;
}

/**
 * Compara dos severidades.
 * @param {string} a
 * @param {string} b
 * @returns {number} >0 si a es mas grave
 */
export function compararSeveridad(a, b) {
  return (PESO_SEVERIDAD[a] ?? 0) - (PESO_SEVERIDAD[b] ?? 0);
}

/**
 * Deriva el estado global de la reconciliacion a partir de las discrepancias.
 * @param {Discrepancia[]} discrepancias
 * @returns {string}
 */
export function derivarEstado(discrepancias) {
  if (!discrepancias.length) return ESTADOS_RECONCILIACION.APROBADO;
  let maxima = SEVERIDADES.INFORMATIVA;
  let pideRevision = false;
  for (const d of discrepancias) {
    if (compararSeveridad(d.severidad, maxima) > 0) maxima = d.severidad;
    if (d.requiere_revision_manual) pideRevision = true;
  }
  if (maxima === SEVERIDADES.CRITICA) return ESTADOS_RECONCILIACION.RECHAZADO;
  if (maxima === SEVERIDADES.ALTA || maxima === SEVERIDADES.MEDIA) {
    return ESTADOS_RECONCILIACION.REQUIERE_REVISION;
  }
  if (pideRevision) return ESTADOS_RECONCILIACION.REQUIERE_REVISION;
  return ESTADOS_RECONCILIACION.APROBADO_CON_OBSERVACIONES;
}
