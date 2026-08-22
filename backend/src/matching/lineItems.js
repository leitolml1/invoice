/**
 * Emparejamiento de items de factura contra items de orden de compra.
 *
 * CAPA 1 PURA: no hay IA aca. El emparejamiento es independiente del orden de
 * las lineas y prioriza senales fuertes (codigo/SKU) sobre las debiles
 * (similitud de descripcion).
 *
 * Los pares que caen en la zona gris NO se resuelven aca: se devuelven como
 * `candidatos_ambiguos` para que el motor decida si consulta la Capa 2.
 */

import { normalizarCodigo, similitudDescripcion } from '../util/text.js';

/**
 * @typedef {object} Asignacion
 * @property {number} indice_factura
 * @property {number} indice_orden
 * @property {number} linea_factura
 * @property {number} linea_orden
 * @property {number} score
 * @property {'codigo'|'descripcion_exacta'|'descripcion_similar'|'ia_semantica'} metodo
 * @property {boolean} codigos_discrepan
 */

/**
 * @typedef {object} CandidatoAmbiguo
 * @property {number} indice_factura
 * @property {number} indice_orden
 * @property {number} linea_factura
 * @property {number} linea_orden
 * @property {number} score
 * @property {string} texto_factura
 * @property {string} texto_orden
 */

/**
 * @typedef {object} ResultadoEmparejamiento
 * @property {Asignacion[]} asignaciones
 * @property {CandidatoAmbiguo[]} candidatos_ambiguos
 * @property {number[]} factura_sin_asignar indices de items de factura sin par
 * @property {number[]} orden_sin_asignar indices de items de orden sin par
 */

/**
 * Calcula el score de identidad entre un item de factura y uno de orden.
 *
 * El score mide SOLO identidad ("es el mismo producto"), no acuerdo de valores.
 * Cantidad y precio entran con peso minimo, unicamente como desempate cuando
 * la OC repite descripciones. Si pesaran mas, una diferencia de precio haria
 * que el item se declare "no presente en la orden" en vez de reportar la
 * diferencia de precio, que es lo que realmente queremos.
 *
 * @param {import('../schema/invoice.js').ItemFacturaNormalizado} itemFactura
 * @param {import('../schema/order.js').ItemOrdenNormalizado} itemOrden
 * @returns {{ score: number, metodo: Asignacion['metodo'], codigos_discrepan: boolean, similitud_descripcion: number }}
 */
export function scoreIdentidad(itemFactura, itemOrden) {
  const codigoFactura = normalizarCodigo(itemFactura.codigo?.valor);
  const codigoOrden = itemOrden.codigo_normalizado;
  const hayCodigos = Boolean(codigoFactura && codigoOrden);
  const codigosIguales = hayCodigos && codigoFactura === codigoOrden;
  const codigosDiscrepan = hayCodigos && !codigosIguales;

  const sim = similitudDescripcion(itemFactura.descripcion?.valor, itemOrden.descripcion);

  if (codigosIguales) {
    return {
      score: 1,
      metodo: 'codigo',
      codigos_discrepan: false,
      similitud_descripcion: sim.score
    };
  }

  let score = sim.score;
  // Si los codigos existen y difieren, penalizamos: puede ser otro producto
  // (o un error de OCR en el codigo, que queda registrado en el contexto).
  if (codigosDiscrepan) score *= 0.9;

  // Desempates de peso minimo.
  score += 0.02 * cercania(itemFactura.precio_unitario_centavos, itemOrden.precio_unitario_centavos);
  score += 0.02 * cercania(itemFactura.cantidad_milesimas, itemOrden.cantidad_milesimas);
  score = Math.min(1, Number(score.toFixed(4)));

  return {
    score,
    metodo: sim.score === 1 ? 'descripcion_exacta' : 'descripcion_similar',
    codigos_discrepan: codigosDiscrepan,
    similitud_descripcion: sim.score
  };
}

/**
 * Cercania relativa entre dos enteros, 0..1.
 * @param {number|null} a
 * @param {number|null} b
 * @returns {number}
 */
function cercania(a, b) {
  if (a === null || b === null) return 0;
  if (a === b) return 1;
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return 1;
  return Math.max(0, 1 - Math.abs(a - b) / base);
}

/**
 * Empareja items de factura y orden de forma determinisitica.
 *
 * @param {import('../schema/invoice.js').ItemFacturaNormalizado[]} itemsFactura
 * @param {import('../schema/order.js').ItemOrdenNormalizado[]} itemsOrden
 * @param {{ coincide: number, distinto: number }} umbrales
 * @returns {ResultadoEmparejamiento}
 */
export function emparejarItems(itemsFactura, itemsOrden, umbrales) {
  /** @type {{ i: number, j: number, score: number, metodo: Asignacion['metodo'], codigos_discrepan: boolean }[]} */
  const pares = [];

  for (let i = 0; i < itemsFactura.length; i++) {
    for (let j = 0; j < itemsOrden.length; j++) {
      const r = scoreIdentidad(itemsFactura[i], itemsOrden[j]);
      if (r.score <= 0) continue;
      pares.push({ i, j, score: r.score, metodo: r.metodo, codigos_discrepan: r.codigos_discrepan });
    }
  }

  // Orden estable y determinisitico: score desc, luego indices asc.
  pares.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);

  const facturaUsada = new Set();
  const ordenUsada = new Set();
  /** @type {Asignacion[]} */
  const asignaciones = [];

  // Pasada 1: solo pares por encima del umbral de coincidencia.
  for (const par of pares) {
    if (par.score < umbrales.coincide) continue;
    if (facturaUsada.has(par.i) || ordenUsada.has(par.j)) continue;
    facturaUsada.add(par.i);
    ordenUsada.add(par.j);
    asignaciones.push({
      indice_factura: par.i,
      indice_orden: par.j,
      linea_factura: itemsFactura[par.i].linea,
      linea_orden: itemsOrden[par.j].linea,
      score: par.score,
      metodo: par.metodo,
      codigos_discrepan: par.codigos_discrepan
    });
  }

  // Pasada 2: zona gris, solo entre los que quedaron libres.
  /** @type {CandidatoAmbiguo[]} */
  const candidatosAmbiguos = [];
  for (const par of pares) {
    if (par.score >= umbrales.coincide || par.score < umbrales.distinto) continue;
    if (facturaUsada.has(par.i) || ordenUsada.has(par.j)) continue;
    if (candidatosAmbiguos.some((c) => c.indice_factura === par.i || c.indice_orden === par.j)) {
      continue;
    }
    candidatosAmbiguos.push({
      indice_factura: par.i,
      indice_orden: par.j,
      linea_factura: itemsFactura[par.i].linea,
      linea_orden: itemsOrden[par.j].linea,
      score: par.score,
      texto_factura: itemsFactura[par.i].descripcion?.valor ?? '',
      texto_orden: itemsOrden[par.j].descripcion ?? ''
    });
  }

  const facturaSinAsignar = [];
  for (let i = 0; i < itemsFactura.length; i++) if (!facturaUsada.has(i)) facturaSinAsignar.push(i);
  const ordenSinAsignar = [];
  for (let j = 0; j < itemsOrden.length; j++) if (!ordenUsada.has(j)) ordenSinAsignar.push(j);

  return {
    asignaciones,
    candidatos_ambiguos: candidatosAmbiguos,
    factura_sin_asignar: facturaSinAsignar,
    orden_sin_asignar: ordenSinAsignar
  };
}

/**
 * Confirma un candidato ambiguo como asignacion (usado tras resolver Capa 2).
 * Mutila el resultado de emparejamiento in place.
 *
 * @param {ResultadoEmparejamiento} resultado
 * @param {CandidatoAmbiguo} candidato
 * @param {Asignacion['metodo']} metodo
 */
export function confirmarAsignacion(resultado, candidato, metodo = 'ia_semantica') {
  const yaUsadaFactura = resultado.asignaciones.some(
    (a) => a.indice_factura === candidato.indice_factura
  );
  const yaUsadaOrden = resultado.asignaciones.some(
    (a) => a.indice_orden === candidato.indice_orden
  );
  if (yaUsadaFactura || yaUsadaOrden) return;

  resultado.asignaciones.push({
    indice_factura: candidato.indice_factura,
    indice_orden: candidato.indice_orden,
    linea_factura: candidato.linea_factura,
    linea_orden: candidato.linea_orden,
    score: candidato.score,
    metodo,
    codigos_discrepan: false
  });
  resultado.factura_sin_asignar = resultado.factura_sin_asignar.filter(
    (i) => i !== candidato.indice_factura
  );
  resultado.orden_sin_asignar = resultado.orden_sin_asignar.filter(
    (j) => j !== candidato.indice_orden
  );
}
