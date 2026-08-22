/**
 * Reglas determinisiticas de cabecera: moneda, referencia a la OC y fechas.
 * Logica pura, sin IA.
 */

import { crearDiscrepancia, TIPOS_DISCREPANCIA, SEVERIDADES } from '../../schema/discrepancy.js';
import { normalizarCodigo } from '../../util/text.js';
import { diferenciaDias, sumarDias, formatearFecha } from '../../util/dates.js';

/**
 * @param {object} ctx
 * @returns {{ discrepancias: import('../../schema/discrepancy.js').Discrepancia[], pendientes: object[] }}
 */
export function reglaMoneda({ factura, orden, config }) {
  const discrepancias = [];
  const monedaFactura = factura.moneda;
  const monedaOrden = orden.moneda || config.moneda_por_defecto;

  if (!monedaFactura.presente) {
    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.CAMPO_ILEGIBLE,
        campo: 'moneda',
        valor_factura: null,
        valor_ordenado: monedaOrden,
        explicacion_legible:
          'La factura no declara moneda de forma legible. Para comparar montos se asumio ' +
          `la moneda de la orden de compra (${monedaOrden}). Si la factura estuviera en otra ` +
          'moneda, todas las comparaciones de importes serian invalidas.',
        severidad: SEVERIDADES.MEDIA,
        sugerencia: 'Confirmar la moneda en el documento original antes de aprobar.',
        contexto: { moneda_asumida: monedaOrden }
      })
    );
    return { discrepancias, pendientes: [] };
  }

  if (monedaFactura.valor !== monedaOrden) {
    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.MONEDA_DISTINTA,
        campo: 'moneda',
        valor_factura: monedaFactura.valor,
        valor_ordenado: monedaOrden,
        explicacion_legible:
          `La factura esta emitida en ${monedaFactura.valor} y la orden de compra en ${monedaOrden}. ` +
          'El motor no aplica tipo de cambio, por lo que las comparaciones de importes de esta ' +
          'reconciliacion no son concluyentes.',
        severidad: SEVERIDADES.CRITICA,
        sugerencia: 'Pedir la factura en la moneda de la orden o registrar el tipo de cambio acordado.',
        contexto: {}
      })
    );
  }

  return { discrepancias, pendientes: [] };
}

/**
 * @param {object} ctx
 * @returns {{ discrepancias: import('../../schema/discrepancy.js').Discrepancia[], pendientes: object[] }}
 */
export function reglaReferenciaOrden({ factura, orden }) {
  const discrepancias = [];
  const ref = factura.orden_compra_referencia;
  if (!ref.presente) return { discrepancias, pendientes: [] };

  if (normalizarCodigo(ref.valor) !== normalizarCodigo(orden.orden_id)) {
    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.OC_REFERENCIA_NO_COINCIDE,
        campo: 'orden_compra_referencia',
        valor_factura: ref.valor,
        valor_ordenado: orden.orden_id,
        explicacion_legible:
          `La factura referencia la orden de compra "${ref.valor}" pero se esta reconciliando ` +
          `contra "${orden.orden_id}". Puede que la factura corresponda a otra orden.`,
        severidad: SEVERIDADES.ALTA,
        confianza: ref.confianza,
        sugerencia: `Buscar la orden "${ref.valor}" y reconciliar contra esa.`,
        contexto: { confianza_lectura: ref.confianza }
      })
    );
  }

  return { discrepancias, pendientes: [] };
}

/**
 * @param {object} ctx
 * @returns {{ discrepancias: import('../../schema/discrepancy.js').Discrepancia[], pendientes: object[] }}
 */
export function reglaFechas({ factura, orden, config }) {
  const discrepancias = [];
  const fecha = factura.fecha_emision;

  if (!fecha.presente) {
    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.CAMPO_ILEGIBLE,
        campo: 'fecha_emision',
        valor_factura: fecha.texto_crudo ?? null,
        valor_ordenado: orden.fecha_emision,
        explicacion_legible:
          'No se pudo interpretar la fecha de emision de la factura' +
          (fecha.texto_crudo ? ` (se leyo "${fecha.texto_crudo}")` : '') +
          '. No es posible validar que la factura sea posterior a la orden de compra.',
        severidad: SEVERIDADES.ALTA,
        sugerencia: 'Corregir la fecha a mano o reprocesar el documento.',
        contexto: { texto_crudo: fecha.texto_crudo }
      })
    );
    return { discrepancias, pendientes: [] };
  }

  if (!orden.fecha_emision) return { discrepancias, pendientes: [] };

  const ambigua = Boolean(fecha.extra?.ambigua);
  const dias = diferenciaDias(fecha.valor, orden.fecha_emision);

  if (dias !== null && dias < -config.fechas.dias_gracia_previos) {
    // Si la fecha era ambigua, chequeamos si la lectura alternativa resolveria el problema.
    const alternativo = fecha.extra?.iso_alternativo ?? null;
    const alternativoResuelve =
      alternativo !== null && (diferenciaDias(alternativo, orden.fecha_emision) ?? -1) >= 0;

    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.FECHA_FACTURA_ANTERIOR_A_ORDEN,
        campo: 'fecha_emision',
        valor_factura: fecha.valor,
        valor_ordenado: orden.fecha_emision,
        explicacion_legible:
          `La factura esta fechada el ${formatearFecha(fecha.valor)}, ${Math.abs(dias)} dia(s) ` +
          `antes de la orden de compra (${formatearFecha(orden.fecha_emision)}). No se puede ` +
          'facturar un pedido que todavia no se habia emitido.' +
          (alternativoResuelve
            ? ` Atencion: la fecha era ambigua y podria leerse como ${formatearFecha(alternativo)}, ` +
              'lo que si seria valido.'
            : ''),
        severidad: alternativoResuelve ? SEVERIDADES.MEDIA : SEVERIDADES.ALTA,
        delta: dias,
        confianza: alternativoResuelve ? 0.6 : fecha.confianza,
        sugerencia: alternativoResuelve
          ? 'Verificar el formato de fecha del documento (dd/mm vs mm/dd).'
          : 'Pedir aclaracion al proveedor o verificar si corresponde a otra orden.',
        contexto: { dias_diferencia: dias, fecha_ambigua: ambigua, lectura_alternativa: alternativo }
      })
    );
  } else if (orden.fecha_entrega_esperada) {
    const limite = sumarDias(orden.fecha_entrega_esperada, config.fechas.dias_gracia_posteriores);
    const excedente = limite ? diferenciaDias(fecha.valor, limite) : null;
    if (excedente !== null && excedente > 0) {
      discrepancias.push(
        crearDiscrepancia({
          tipo: TIPOS_DISCREPANCIA.FECHA_FUERA_DE_RANGO,
          campo: 'fecha_emision',
          valor_factura: fecha.valor,
          valor_ordenado: orden.fecha_entrega_esperada,
          explicacion_legible:
            `La factura esta fechada el ${formatearFecha(fecha.valor)}, ${excedente} dia(s) mas ` +
            `alla del margen aceptado (entrega esperada ${formatearFecha(orden.fecha_entrega_esperada)} ` +
            `+ ${config.fechas.dias_gracia_posteriores} dias de gracia). Puede ser una factura ` +
            'tardia o corresponder a otro periodo.',
          severidad: SEVERIDADES.MEDIA,
          delta: excedente,
          confianza: fecha.confianza,
          sugerencia: 'Revisar si la orden sigue vigente o si la factura duplica una ya pagada.',
          contexto: { limite_aceptado: limite, dias_excedidos: excedente }
        })
      );
    }
  }

  if (ambigua && fecha.extra?.iso_alternativo) {
    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.FECHA_AMBIGUA,
        campo: 'fecha_emision',
        valor_factura: fecha.valor,
        valor_ordenado: orden.fecha_emision,
        explicacion_legible:
          `La fecha "${fecha.texto_crudo ?? fecha.valor_crudo}" es ambigua: se interpreto como ` +
          `${formatearFecha(fecha.valor)} (formato ${config.formato_fecha_preferido}), pero tambien ` +
          `podria ser ${formatearFecha(fecha.extra.iso_alternativo)}.`,
        severidad: SEVERIDADES.INFORMATIVA,
        requiere_revision_manual: false,
        confianza: 0.5,
        sugerencia: 'Definir el formato de fecha esperado por proveedor.',
        contexto: { lectura_alternativa: fecha.extra.iso_alternativo }
      })
    );
  }

  return { discrepancias, pendientes: [] };
}
