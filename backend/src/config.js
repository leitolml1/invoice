/**
 * Configuracion del motor de reconciliacion.
 *
 * Todos los umbrales viven aca para que sean auditables: ninguna regla
 * hardcodea tolerancias. Persona C puede exponer estos valores en la UI.
 */

/** @typedef {{ centavos: number, relativa: number }} Tolerancia */

export const DEFAULT_CONFIG = {
  /** Moneda asumida cuando ni la factura ni la orden la declaran. */
  moneda_por_defecto: 'USD',

  /**
   * Interpretacion de fechas numericas ambiguas (ej. 03/07/2026).
   * 'dmy' = dia/mes/anio (convencion LATAM/ES), 'mdy' = mes/dia/anio (US).
   */
  formato_fecha_preferido: 'dmy',

  confianza: {
    /** Debajo de esto se pide revision manual del campo. */
    umbral_bajo: 0.75,
    /** Debajo de esto el campo se considera practicamente ilegible. */
    umbral_critico: 0.5,
    /** Confianza asumida cuando Persona A manda un escalar pelado, sin metadata. */
    por_defecto_si_ausente: 1
  },

  /**
   * Tolerancias monetarias. `centavos` es absoluta (absorbe redondeo),
   * `relativa` es fraccion del valor ordenado. Se acepta la diferencia si
   * |delta| <= max(centavos, relativa * |ordenado|).
   *
   * Nota deliberada: las tolerancias relativas son 0 o casi 0. Con una
   * tolerancia relativa "comoda" (ej. 0.5%) un error de OCR tipico como
   * 1234.56 -> 1234.65 pasaria desapercibido, que es exactamente el caso
   * que este motor tiene que cazar.
   */
  tolerancias: {
    total: { centavos: 2, relativa: 0 },
    subtotal: { centavos: 2, relativa: 0 },
    impuestos: { centavos: 2, relativa: 0.0005 },
    importe_linea: { centavos: 2, relativa: 0 },
    precio_unitario: { centavos: 1, relativa: 0 },
    /** Consistencia interna de la factura: subtotal + impuestos - descuentos == total. */
    aritmetica_interna: { centavos: 2, relativa: 0 },
    /** Tolerancia de cantidad, en milesimas de unidad (0 = exacta). */
    cantidad_milesimas: 0
  },

  fechas: {
    /** Dias que la factura puede anteceder a la fecha de la orden. */
    dias_gracia_previos: 0,
    /** Dias despues de la fecha de entrega esperada que siguen siendo validos. */
    dias_gracia_posteriores: 60
  },

  /**
   * Bandas de similitud de texto (0..1).
   * >= coincide  -> Capa 1 resuelve: son lo mismo.
   * <  distinto  -> Capa 1 resuelve: son distintos.
   * en el medio   -> zona gris: unico lugar donde se consulta la IA (Capa 2).
   */
  similitud: {
    proveedor: { coincide: 0.9, distinto: 0.55 },
    item: { coincide: 0.82, distinto: 0.5 }
  },

  /** Score minimo para vincular una factura a una orden sin referencia explicita. */
  seleccion_orden: { score_minimo: 0.55 },

  /** Corte de severidad por magnitud relativa del desvio monetario. */
  severidad_por_magnitud: {
    media_hasta: 0.005,
    alta_hasta: 0.1
  },

  /** Si true, faltar items de la OC en la factura baja a severidad informativa. */
  entregas_parciales_permitidas: false,

  /** Capa 2 - fallback semantico con QVAC. Apagado por defecto: la IA es el ultimo recurso. */
  ia: {
    habilitada: false,
    /** 'embeddings' (embed + cosine) | 'llm' (completion con veredicto JSON) */
    estrategia: 'embeddings',
    /** Nombre de constante exportada por @qvac/sdk, o ruta absoluta a un .gguf. */
    modelo_embeddings: 'GTE_LARGE_FP16',
    modelo_llm: 'QWEN3_600M_INST_Q4',
    /** Cosine >= esto => equivalentes. Cosine <= (esto - margen_indeciso) => distintos. */
    umbral_similitud_embeddings: 0.82,
    margen_indeciso: 0.12,
    /** Tope de consultas a la IA por documento, para que no se vaya de las manos. */
    max_consultas_por_documento: 12,
    timeout_ms: 120000,
    /** Se pasa tal cual a loadModel({ modelConfig }). */
    model_config: {}
  }
};

/**
 * Merge profundo de configuracion parcial sobre los defaults.
 * @param {object} [override]
 * @param {object} [base]
 * @returns {typeof DEFAULT_CONFIG}
 */
export function crearConfig(override, base = DEFAULT_CONFIG) {
  const salida = Array.isArray(base) ? [...base] : { ...base };
  if (!override || typeof override !== 'object') return salida;
  for (const [clave, valor] of Object.entries(override)) {
    if (valor === undefined) continue;
    const actual = salida[clave];
    const ambosObjetos =
      valor && typeof valor === 'object' && !Array.isArray(valor) &&
      actual && typeof actual === 'object' && !Array.isArray(actual);
    salida[clave] = ambosObjetos ? crearConfig(valor, actual) : valor;
  }
  return salida;
}
