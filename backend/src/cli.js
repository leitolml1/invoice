#!/usr/bin/env node
/**
 * CLI del Modulo B. Reconcilia una factura ya extraida (JSON) contra una orden
 * de compra (JSON o CSV) y escribe el resultado interno completo.
 *
 * Uso:
 *   node src/cli.js reconcile --factura <ruta.json> --orden <ruta.json|ruta.csv> [opciones]
 *
 * Opciones:
 *   --orden-id <id>   si el archivo de ordenes trae varias, elige una
 *   --out <ruta>      guarda el resultado JSON en un archivo
 *   --json            imprime el resultado JSON completo por stdout
 *   --config <ruta>   JSON con overrides de configuracion
 *
 * Nota: este CLI NO hace OCR. Espera el JSON ya extraido, con el contrato que
 * documenta schema/invoice.js.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { reconciliar } from './matching/engine.js';
import { parsearFacturaExtraida } from './schema/invoice.js';
import { parsearOrden, parsearOrdenesJson, parsearOrdenesCsv } from './schema/order.js';
import { crearConfig } from './config.js';
import { PESO_SEVERIDAD } from './schema/discrepancy.js';
import { formatearMonto, aCentavos } from './util/money.js';

const USO = `
InvoiceGuard - Modulo B (motor de reconciliacion)

  node src/cli.js reconcile --factura <ruta.json> --orden <ruta.json|.csv> [--orden-id ID] [--out ruta] [--json] [--config ruta]

`;

/**
 * @param {string[]} argv
 * @returns {{ comando: string, opciones: Record<string, string|boolean> }}
 */
function parsearArgumentos(argv) {
  const [comando = '', ...resto] = argv;
  /** @type {Record<string, string|boolean>} */
  const opciones = {};
  for (let i = 0; i < resto.length; i++) {
    const token = resto[i];
    if (!token.startsWith('--')) continue;
    const clave = token.slice(2);
    const siguiente = resto[i + 1];
    if (siguiente === undefined || siguiente.startsWith('--')) {
      opciones[clave] = true;
    } else {
      opciones[clave] = siguiente;
      i++;
    }
  }
  return { comando, opciones };
}

/**
 * Carga ordenes desde JSON o CSV segun la extension.
 * @param {string} ruta
 * @param {object} config
 * @returns {Promise<import('./schema/order.js').OrdenNormalizada[]>}
 */
async function cargarOrdenes(ruta, config) {
  const contenido = await readFile(ruta, 'utf8');
  const extension = path.extname(ruta).toLowerCase();
  if (extension === '.csv' || extension === '.tsv') {
    return parsearOrdenesCsv(contenido, config);
  }
  const datos = JSON.parse(contenido);
  return Array.isArray(datos) || datos?.ordenes || datos?.orders
    ? parsearOrdenesJson(datos, config)
    : [parsearOrden(datos, config)];
}

/**
 * @param {import('./matching/engine.js').ResultadoReconciliacion} resultado
 */
function imprimirReporte(resultado) {
  const { resumen } = resultado;
  console.log('');
  console.log(`Factura        : ${resultado.documento_id}`);
  console.log(`Orden          : ${resultado.orden_id}`);
  console.log(`Estado         : ${resultado.estado.toUpperCase()}`);
  console.log(
    `Discrepancias  : ${resumen.total_discrepancias}` +
      (resumen.total_discrepancias
        ? ` (criticas ${resumen.por_severidad.critica}, altas ${resumen.por_severidad.alta}, ` +
          `medias ${resumen.por_severidad.media}, bajas ${resumen.por_severidad.baja}, ` +
          `informativas ${resumen.por_severidad.informativa})`
        : '')
  );
  console.log(
    `Monto disputado: ${formatearMonto(aCentavos(resumen.monto_en_disputa), resumen.moneda)}`
  );
  console.log(`Revision manual: ${resumen.requiere_revision_manual ? 'SI' : 'no'}`);
  console.log(`Duracion       : ${resultado.trazabilidad.duracion_ms} ms`);

  if (resultado.trazabilidad.advertencias_parseo.length) {
    console.log('');
    console.log('Advertencias de parseo:');
    for (const a of resultado.trazabilidad.advertencias_parseo) console.log(`  - ${a}`);
  }

  if (!resultado.discrepancias.length) {
    console.log('');
    console.log('Sin discrepancias: la factura coincide con la orden de compra.');
    return;
  }

  console.log('');
  console.log('Discrepancias detectadas:');
  for (const d of resultado.discrepancias) {
    console.log('');
    console.log(`  [${d.severidad.toUpperCase()}] ${d.tipo}  (${d.campo})`);
    console.log(`     factura: ${formatearValor(d.valor_factura)}`);
    console.log(`     orden  : ${formatearValor(d.valor_ordenado)}`);
    console.log(`     ${d.explicacion_legible}`);
    if (d.sugerencia) console.log(`     -> ${d.sugerencia}`);
    if (d.requiere_revision_manual) console.log('     -> requiere revision manual');
  }

  console.log('');
  console.log('Items conciliados:');
  for (const item of resultado.items_conciliados) {
    console.log(
      `  factura L${item.linea_factura} <-> orden L${item.linea_orden}  ` +
        `[${item.metodo_match}, score ${item.score_match}]  ${item.estado}`
    );
  }
}

/**
 * @param {unknown} v
 */
function formatearValor(v) {
  if (v === null || v === undefined) return '(sin dato)';
  return String(v);
}

async function main() {
  const { comando, opciones } = parsearArgumentos(process.argv.slice(2));

  if (!comando || comando === 'help' || opciones.help) {
    console.log(USO);
    process.exit(comando ? 0 : 1);
  }

  if (comando !== 'reconcile') {
    console.error(`Comando desconocido: "${comando}"`);
    console.log(USO);
    process.exit(1);
  }

  const rutaFactura = opciones.factura;
  const rutaOrden = opciones.orden ?? opciones.ordenes;
  if (typeof rutaFactura !== 'string' || typeof rutaOrden !== 'string') {
    console.error('Faltan --factura y/o --orden.');
    console.log(USO);
    process.exit(1);
  }

  let config = crearConfig();
  if (typeof opciones.config === 'string') {
    config = crearConfig(JSON.parse(await readFile(opciones.config, 'utf8')));
  }

  const facturaCruda = JSON.parse(await readFile(rutaFactura, 'utf8'));
  const factura = parsearFacturaExtraida(facturaCruda, config);

  const ordenes = await cargarOrdenes(rutaOrden, config);
  if (!ordenes.length) {
    console.error(`El archivo de ordenes "${rutaOrden}" no contiene ninguna orden.`);
    process.exit(1);
  }

  let orden = ordenes[0];
  if (typeof opciones['orden-id'] === 'string') {
    const buscada = ordenes.find((o) => o.orden_id === opciones['orden-id']);
    if (!buscada) {
      console.error(
        `No se encontro la orden "${opciones['orden-id']}". Disponibles: ` +
          ordenes.map((o) => o.orden_id).join(', ')
      );
      process.exit(1);
    }
    orden = buscada;
  } else if (ordenes.length > 1) {
    console.error(
      `El archivo trae ${ordenes.length} ordenes (${ordenes.map((o) => o.orden_id).join(', ')}). ` +
        'Elegí una con --orden-id.'
    );
    process.exit(1);
  }

  const resultado = reconciliar({ factura, orden, config });

  if (opciones.json) {
    console.log(JSON.stringify(resultado, null, 2));
  } else {
    imprimirReporte(resultado);
  }

  if (typeof opciones.out === 'string') {
    await writeFile(opciones.out, JSON.stringify(resultado, null, 2), 'utf8');
    console.log('');
    console.log(`Resultado guardado en ${opciones.out}`);
  }

  // Codigo de salida util para scripts: 0 sin hallazgos graves, 1 si hay.
  const grave = resultado.discrepancias.some((d) => PESO_SEVERIDAD[d.severidad] >= PESO_SEVERIDAD.alta);
  process.exit(grave ? 1 : 0);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(2);
});
