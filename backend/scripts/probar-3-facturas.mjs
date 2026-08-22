/**
 * Corre el Modulo A completo sobre las 3 facturas de prueba y volca el JSON de
 * salida de cada una.
 *
 * Reusa el OCR cacheado en .ocr-cache/ (generado por scripts/probar-tabla.mjs)
 * para no tener el modelo de OCR y el del LLM cargados a la vez: en esta
 * maquina, 7 GB de RAM, los dos juntos disparan el OOM killer.
 *
 * Uso: node scripts/probar-3-facturas.mjs [--json] [imagen...]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { extraerFactura } from '../src/extraction/extract.js';
import { liberarModeloEstructurador } from '../src/extraction/structurer.js';

const args = process.argv.slice(2);
const volcarJson = args.includes('--json');
const imagenes = args.filter((a) => !a.startsWith('--'));
const objetivos = imagenes.length
  ? imagenes
  : [
      'test-assets/factura-01-limpia.png',
      'test-assets/factura-02-escaneada.png',
      'test-assets/factura-03-degradada.png'
    ];

/** Ground truth leido a ojo de las imagenes, para comparar. */
const ESPERADO = {
  proveedor: 'Distribuidora del Sur S.A.',
  identificacion_fiscal: '30-71234567-9',
  numero_factura: 'A-0001-00099',
  fecha: '18/07/2026',
  moneda: 'USD',
  orden_compra_referencia: 'PO-2026-0001',
  items: [
    { codigo: 'SKU-100', nombre: 'Cable UTP Cat6 305m', cantidad: 12, precio_unitario: 85.5, total: 1026 },
    { codigo: 'SKU-200', nombre: 'Switch 24 puertos Gigabit', cantidad: 2, precio_unitario: 210, total: 420 },
    { codigo: 'SKU-300', nombre: 'Patch panel 24 bocas', cantidad: 4, precio_unitario: 49, total: 196 }
  ],
  subtotal: 1642,
  impuestos: 344.82,
  total_factura: 1986.82
};

const v = (campo) => (campo?.valor ?? null);
const marca = (campo) => {
  if (!campo) return '';
  const f = [];
  if (campo.needs_review) f.push('REVISAR');
  if (campo.valor !== null && campo.verificado_en_ocr === false) f.push('NO-EN-OCR');
  return f.length ? ` [${f.join('+')}]` : '';
};

const resumen = [];

for (const imagen of objetivos) {
  const cache = path.join('.ocr-cache', `${path.basename(imagen)}.json`);
  let bloquesOcr;
  try {
    bloquesOcr = JSON.parse(await readFile(cache, 'utf8'));
  } catch {
    console.log(`\nSIN CACHE para ${imagen}. Corré primero: node scripts/probar-tabla.mjs --refrescar`);
    continue;
  }

  console.log('');
  console.log('#'.repeat(78));
  console.log(`# ${imagen}`);
  console.log('#'.repeat(78));

  try {
    const f = await extraerFactura(imagen, { bloquesOcr });

    if (volcarJson) {
      await mkdir('salida', { recursive: true });
      const destino = path.join('salida', `${path.basename(imagen, '.png')}.json`);
      await writeFile(destino, JSON.stringify(f, null, 2));
      console.log(`JSON completo en ${destino}`);
    }

    console.log(`proveedor         : ${JSON.stringify(v(f.proveedor.nombre))}${marca(f.proveedor.nombre)}`);
    console.log(`id fiscal         : ${JSON.stringify(v(f.proveedor.identificacion_fiscal))}${marca(f.proveedor.identificacion_fiscal)}`);
    console.log(`numero factura    : ${JSON.stringify(v(f.numero_factura))}${marca(f.numero_factura)}`);
    console.log(`fecha             : ${JSON.stringify(v(f.fecha))}${marca(f.fecha)}`);
    console.log(`moneda            : ${JSON.stringify(v(f.moneda))}${marca(f.moneda)}`);
    console.log(`orden compra ref  : ${JSON.stringify(v(f.orden_compra_referencia))}${marca(f.orden_compra_referencia)}`);
    console.log(`subtotal          : ${v(f.totales.subtotal)}${marca(f.totales.subtotal)}`);
    console.log(`impuestos         : ${v(f.totales.impuestos)}${marca(f.totales.impuestos)}`);
    console.log(`total_factura     : ${v(f.totales.total_factura)}${marca(f.totales.total_factura)}`);
    console.log(`items (${f.items.length}):`);
    for (const it of f.items) {
      console.log(
        `  L${it.linea}  cod=${JSON.stringify(v(it.codigo))}  nombre=${JSON.stringify(v(it.nombre))}`
      );
      console.log(
        `      cant=${v(it.cantidad)}${marca(it.cantidad)}  ` +
          `precio=${v(it.precio_unitario)}${marca(it.precio_unitario)}  ` +
          `total=${v(it.total)}${marca(it.total)}`
      );
    }
    console.log(`needs_review      : ${f.needs_review}`);
    console.log(`confianza_global  : ${f.confianza_global}`);
    console.log(`tabla             : inclinacion ${f.extraccion.tabla.inclinacion_estimada}, ` +
      `encabezado ${f.extraccion.tabla.encabezado_detectado ? 'si' : 'NO'}, ` +
      `columnas [${f.extraccion.tabla.columnas.join(', ')}], ` +
      `filas_items ${f.extraccion.tabla.filas_items}`);

    // Contaminacion del prompt: el sintoma exacto del Bug 1.
    const strings = [
      v(f.proveedor.nombre), v(f.proveedor.identificacion_fiscal), v(f.numero_factura),
      v(f.fecha), v(f.moneda), v(f.orden_compra_referencia),
      ...f.items.flatMap((i) => [v(i.codigo), v(i.nombre)])
    ].filter((x) => typeof x === 'string');
    const contaminados = strings.filter((s) => /@x\d+/.test(s));
    const noEnOcr = [
      f.proveedor.nombre, f.proveedor.identificacion_fiscal, f.numero_factura, f.fecha,
      f.moneda, f.orden_compra_referencia,
      ...f.items.flatMap((i) => [i.codigo, i.nombre, i.cantidad, i.precio_unitario, i.total])
    ].filter((c) => c && c.valor !== null && c.verificado_en_ocr === false).length;

    console.log(`valores con "@xN" : ${contaminados.length}${contaminados.length ? '  <-- BUG 1 PRESENTE' : ''}`);
    console.log(`campos no hallados en OCR: ${noEnOcr}`);

    if (f.extraccion.advertencias.length) {
      console.log('advertencias:');
      for (const a of f.extraccion.advertencias) console.log(`  - ${a}`);
    }

    resumen.push({
      imagen: path.basename(imagen),
      items: f.items.length,
      contaminados: contaminados.length,
      noEnOcr,
      confianza: f.confianza_global,
      cantidades: f.items.map((i) => v(i.cantidad)),
      llm_ms: f.extraccion.llm.duracion_ms
    });
  } catch (error) {
    console.log(`FALLO [${error.codigo ?? error.name}]: ${error.message}`);
    resumen.push({ imagen: path.basename(imagen), fallo: error.message });
  }
}

console.log('');
console.log('='.repeat(78));
console.log('RESUMEN');
console.log('='.repeat(78));
console.log('(esperado: 3 items, 0 contaminados, cantidades 12/2/4)');
for (const r of resumen) {
  if (r.fallo) {
    console.log(`  ${r.imagen.padEnd(30)} FALLO: ${r.fallo.slice(0, 40)}`);
    continue;
  }
  console.log(
    `  ${r.imagen.padEnd(30)} items ${r.items}  @xN ${r.contaminados}  ` +
      `no-en-ocr ${String(r.noEnOcr).padStart(2)}  conf ${r.confianza}  ` +
      `cant [${r.cantidades.join(',')}]  LLM ${r.llm_ms}ms`
  );
}

await liberarModeloEstructurador().catch(() => {});
const { close } = await import('@qvac/sdk');
await close();
