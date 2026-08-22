/**
 * Reglas determinisiticas a nivel de linea, una vez que los items ya fueron
 * emparejados por matching/lineItems.js.
 */

import {
  crearDiscrepancia,
  TIPOS_DISCREPANCIA,
  SEVERIDADES,
  CAPAS,
  severidadPorMagnitud
} from '../../schema/discrepancy.js';
import {
  compararCentavos,
  formatearMonto,
  formatearCantidad,
  detectarPatronOcr,
  aMonto,
  aCantidad
} from '../../util/money.js';
import { normalizarCodigo } from '../../util/text.js';

/**
 * Compara todos los pares emparejados y reporta lo que sobra o falta.
 *
 * @param {object} ctx
 * @param {import('../../schema/invoice.js').FacturaNormalizada} ctx.factura
 * @param {import('../../schema/order.js').OrdenNormalizada} ctx.orden
 * @param {object} ctx.config
 * @param {import('../lineItems.js').ResultadoEmparejamiento} ctx.emparejamiento
 * @param {string} ctx.moneda
 * @returns {{ discrepancias: import('../../schema/discrepancy.js').Discrepancia[] }}
 */
export function reglaItems({ factura, orden, config, emparejamiento, moneda }) {
  const discrepancias = [];

  // --- Pares emparejados: comparar valores ---
  const asignacionesOrdenadas = [...emparejamiento.asignaciones].sort(
    (a, b) => a.linea_factura - b.linea_factura
  );

  for (const asignacion of asignacionesOrdenadas) {
    const itemF = factura.items[asignacion.indice_factura];
    const itemO = orden.items[asignacion.indice_orden];
    const etiqueta = itemO.descripcion ?? itemF.descripcion?.valor ?? `linea ${itemF.linea}`;
    const base = `items[${itemF.linea}]`;

    // Unidad de medida.
    const unidadF = itemF.unidad?.valor ?? null;
    if (unidadF && itemO.unidad && unidadF !== itemO.unidad) {
      discrepancias.push(
        crearDiscrepancia({
          tipo: TIPOS_DISCREPANCIA.UNIDAD_DISTINTA,
          campo: `${base}.unidad`,
          valor_factura: unidadF,
          valor_ordenado: itemO.unidad,
          explicacion_legible:
            `En "${etiqueta}" la factura factura en "${unidadF}" y la orden pidio en ` +
            `"${itemO.unidad}". Con unidades distintas la comparacion de cantidades y precios ` +
            'no es directa.',
          severidad: SEVERIDADES.ALTA,
          sugerencia: 'Confirmar el factor de conversion entre unidades con el proveedor.',
          contexto: { linea_orden: itemO.linea }
        })
      );
    }

    // Cantidad.
    if (itemF.cantidad_milesimas !== null && itemO.cantidad_milesimas !== null) {
      const delta = itemF.cantidad_milesimas - itemO.cantidad_milesimas;
      if (Math.abs(delta) > config.tolerancias.cantidad_milesimas) {
        const mas = delta > 0;
        discrepancias.push(
          crearDiscrepancia({
            tipo: TIPOS_DISCREPANCIA.CANTIDAD_NO_COINCIDE,
            campo: `${base}.cantidad`,
            valor_factura: aCantidad(itemF.cantidad_milesimas),
            valor_ordenado: aCantidad(itemO.cantidad_milesimas),
            explicacion_legible:
              `En "${etiqueta}" se facturan ${formatearCantidad(itemF.cantidad_milesimas)} ` +
              `${unidadF ?? itemO.unidad ?? 'u'} pero la orden pidio ` +
              `${formatearCantidad(itemO.cantidad_milesimas)}: ` +
              `${mas ? 'se factura de mas' : 'se factura de menos'} ` +
              `${formatearCantidad(Math.abs(delta))}.`,
            severidad: severidadPorMagnitud(
              delta,
              itemO.cantidad_milesimas,
              config.severidad_por_magnitud
            ),
            delta: aCantidad(delta),
            confianza: itemF.cantidad.confianza,
            sugerencia: mas
              ? 'Pedir nota de credito por la cantidad facturada en exceso.'
              : 'Verificar si hubo entrega parcial y si corresponde una factura complementaria.',
            contexto: {
              linea_orden: itemO.linea,
              metodo_match: asignacion.metodo,
              score_match: asignacion.score
            }
          })
        );
      }
    }

    // Precio unitario.
    if (itemF.precio_unitario_centavos !== null && itemO.precio_unitario_centavos !== null) {
      const cmp = compararCentavos(
        itemF.precio_unitario_centavos,
        itemO.precio_unitario_centavos,
        config.tolerancias.precio_unitario
      );
      if (!cmp.coincide) {
        const patron = detectarPatronOcr(
          itemF.precio_unitario_centavos,
          itemO.precio_unitario_centavos
        );
        discrepancias.push(
          crearDiscrepancia({
            tipo: TIPOS_DISCREPANCIA.PRECIO_UNITARIO_NO_COINCIDE,
            campo: `${base}.precio_unitario`,
            valor_factura: aMonto(itemF.precio_unitario_centavos),
            valor_ordenado: aMonto(itemO.precio_unitario_centavos),
            explicacion_legible:
              `En "${etiqueta}" el precio unitario facturado es ` +
              `${formatearMonto(itemF.precio_unitario_centavos, moneda)} contra ` +
              `${formatearMonto(itemO.precio_unitario_centavos, moneda)} acordado en la orden ` +
              `(${cmp.delta > 0 ? '+' : '-'}${formatearMonto(Math.abs(cmp.delta))}, ` +
              `${(cmp.deltaRelativo * 100).toFixed(2)}%).`,
            severidad: severidadPorMagnitud(
              cmp.delta,
              itemO.precio_unitario_centavos,
              config.severidad_por_magnitud
            ),
            delta: aMonto(cmp.delta),
            confianza: itemF.precio_unitario.confianza,
            sugerencia: patron
              ? `Antes de reclamar, revisar la lectura del OCR: ${patron}.`
              : 'Reclamar el precio acordado en la orden de compra.',
            contexto: {
              linea_orden: itemO.linea,
              desvio_relativo: cmp.deltaRelativo,
              patron_ocr: patron
            }
          })
        );
      }
    }

    // Consistencia interna de la linea: cantidad * precio == importe.
    if (
      itemF.cantidad_milesimas !== null &&
      itemF.precio_unitario_centavos !== null &&
      itemF.importe_linea_centavos !== null
    ) {
      const esperado = Math.round(
        (itemF.cantidad_milesimas * itemF.precio_unitario_centavos) / 1000
      );
      const cmp = compararCentavos(
        itemF.importe_linea_centavos,
        esperado,
        config.tolerancias.importe_linea
      );
      if (!cmp.coincide) {
        discrepancias.push(
          crearDiscrepancia({
            tipo: TIPOS_DISCREPANCIA.IMPORTE_LINEA_INCONSISTENTE,
            campo: `${base}.importe_linea`,
            valor_factura: aMonto(itemF.importe_linea_centavos),
            valor_ordenado: aMonto(esperado),
            explicacion_legible:
              `En "${etiqueta}" la propia factura no cierra: ` +
              `${formatearCantidad(itemF.cantidad_milesimas)} x ` +
              `${formatearMonto(itemF.precio_unitario_centavos, moneda)} da ` +
              `${formatearMonto(esperado, moneda)}, pero el importe de la linea dice ` +
              `${formatearMonto(itemF.importe_linea_centavos, moneda)}.`,
            severidad: severidadPorMagnitud(cmp.delta, esperado, config.severidad_por_magnitud),
            delta: aMonto(cmp.delta),
            confianza: Math.min(
              itemF.cantidad.confianza,
              itemF.precio_unitario.confianza,
              itemF.importe_linea.confianza
            ),
            sugerencia: 'Error aritmetico en la factura o mala lectura del OCR: verificar el documento.',
            contexto: { linea_orden: itemO.linea, importe_esperado: aMonto(esperado) }
          })
        );
      }
    }
  }

  // --- Items facturados que no estan en la orden (o duplicados) ---
  const codigosAsignados = new Set();
  const descripcionesAsignadas = new Set();
  for (const a of emparejamiento.asignaciones) {
    const itemF = factura.items[a.indice_factura];
    const cod = normalizarCodigo(itemF.codigo?.valor);
    if (cod) codigosAsignados.add(cod);
    const desc = (itemF.descripcion?.valor ?? '').trim().toLowerCase();
    if (desc) descripcionesAsignadas.add(desc);
  }

  const ambiguosPorIndiceFactura = new Map(
    emparejamiento.candidatos_ambiguos.map((c) => [c.indice_factura, c])
  );

  for (const i of emparejamiento.factura_sin_asignar) {
    const itemF = factura.items[i];
    const etiqueta = itemF.descripcion?.valor ?? itemF.codigo?.valor ?? `linea ${itemF.linea}`;
    const base = `items[${itemF.linea}]`;
    const importe = itemF.importe_linea_centavos;

    // Si quedo un candidato ambiguo sin resolver, no lo declaramos "no en orden".
    if (ambiguosPorIndiceFactura.has(i)) continue;

    const cod = normalizarCodigo(itemF.codigo?.valor);
    const desc = (itemF.descripcion?.valor ?? '').trim().toLowerCase();
    const esDuplicado = (cod && codigosAsignados.has(cod)) || (!cod && desc && descripcionesAsignadas.has(desc));

    if (esDuplicado) {
      discrepancias.push(
        crearDiscrepancia({
          tipo: TIPOS_DISCREPANCIA.ITEM_DUPLICADO,
          campo: base,
          valor_factura: etiqueta,
          valor_ordenado: null,
          explicacion_legible:
            `La linea ${itemF.linea} ("${etiqueta}") repite un item ya facturado en esta misma ` +
            `factura y la orden de compra lo pide una sola vez. Importe duplicado: ` +
            `${formatearMonto(importe, moneda)}.`,
          severidad: SEVERIDADES.ALTA,
          delta: aMonto(importe),
          confianza: 0.9,
          sugerencia: 'Pedir nota de credito por la linea duplicada.',
          contexto: { codigo: itemF.codigo?.valor ?? null }
        })
      );
      continue;
    }

    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.ITEM_NO_EN_ORDEN,
        campo: base,
        valor_factura: etiqueta,
        valor_ordenado: null,
        explicacion_legible:
          `La factura incluye "${etiqueta}" por ${formatearMonto(importe, moneda)}, que no figura ` +
          `en la orden de compra ${orden.orden_id}. Es un cargo no autorizado.`,
        severidad: SEVERIDADES.ALTA,
        delta: aMonto(importe),
        confianza: 0.9,
        sugerencia: 'Rechazar el cargo o pedir la ampliacion de la orden de compra.',
        contexto: { codigo: itemF.codigo?.valor ?? null, importe: aMonto(importe) }
      })
    );
  }

  // --- Items de la orden que no aparecen en la factura ---
  const ambiguosPorIndiceOrden = new Set(
    emparejamiento.candidatos_ambiguos.map((c) => c.indice_orden)
  );
  for (const j of emparejamiento.orden_sin_asignar) {
    if (ambiguosPorIndiceOrden.has(j)) continue;
    const itemO = orden.items[j];
    const etiqueta = itemO.descripcion ?? itemO.codigo ?? `linea ${itemO.linea}`;
    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.ITEM_FALTANTE_EN_FACTURA,
        campo: `orden.items[${itemO.linea}]`,
        valor_factura: null,
        valor_ordenado: etiqueta,
        explicacion_legible:
          `La orden ${orden.orden_id} incluye "${etiqueta}" por ` +
          `${formatearMonto(itemO.importe_linea_centavos, moneda)} que no aparece facturado. ` +
          'Puede tratarse de una entrega parcial o de un item que el OCR no leyo.',
        severidad: config.entregas_parciales_permitidas ? SEVERIDADES.INFORMATIVA : SEVERIDADES.BAJA,
        requiere_revision_manual: !config.entregas_parciales_permitidas,
        delta: aMonto(itemO.importe_linea_centavos),
        confianza: 0.85,
        sugerencia: 'Confirmar si la entrega fue parcial o si falta leer una linea del documento.',
        contexto: { codigo: itemO.codigo, importe: itemO.importe_linea }
      })
    );
  }

  // --- Candidatos ambiguos que quedaron sin resolver ---
  for (const c of emparejamiento.candidatos_ambiguos) {
    const yaAsignado = emparejamiento.asignaciones.some(
      (a) => a.indice_factura === c.indice_factura
    );
    if (yaAsignado) continue;
    discrepancias.push(itemSinResolver(c, orden, moneda, factura));
  }

  return { discrepancias };
}

/**
 * Discrepancia para un item que quedo en zona gris sin resolucion.
 *
 * @param {import('../lineItems.js').CandidatoAmbiguo} candidato
 * @param {import('../../schema/order.js').OrdenNormalizada} orden
 * @param {string} moneda
 * @param {import('../../schema/invoice.js').FacturaNormalizada} factura
 * @param {string} [motivo]
 * @returns {import('../../schema/discrepancy.js').Discrepancia}
 */
export function itemSinResolver(candidato, orden, moneda, factura, motivo = '') {
  const itemF = factura.items[candidato.indice_factura];
  return crearDiscrepancia({
    tipo: TIPOS_DISCREPANCIA.ITEM_REQUIERE_VERIFICACION,
    campo: `items[${candidato.linea_factura}].descripcion`,
    valor_factura: candidato.texto_factura,
    valor_ordenado: candidato.texto_orden,
    explicacion_legible:
      `No se puede confirmar si "${candidato.texto_factura}" (linea ${candidato.linea_factura} de ` +
      `la factura, ${formatearMonto(itemF.importe_linea_centavos, moneda)}) corresponde a ` +
      `"${candidato.texto_orden}" (linea ${candidato.linea_orden} de la orden ${orden.orden_id}). ` +
      `Similitud ${(candidato.score * 100).toFixed(0)}%: zona gris. ${motivo}`.trim(),
    severidad: SEVERIDADES.MEDIA,
    requiere_revision_manual: true,
    capa: CAPAS.SIN_RESOLVER,
    confianza: 0.5,
    sugerencia: 'Confirmar manualmente si es el mismo producto con otra descripcion.',
    contexto: {
      linea_orden: candidato.linea_orden,
      score_capa1: candidato.score
    }
  });
}
