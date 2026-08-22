/**
 * Prueba el Modulo A sobre varias facturas y reporta latencia y calidad.
 *
 * Uso: node scripts/probar-extraccion.mjs [archivo1 archivo2 ...]
 */
import process from 'node:process';
import { extraerFactura } from '../src/extraction/extract.js';
import { liberarModeloOcr } from '../src/extraction/ocrEngine.js';
import { liberarModeloEstructurador } from '../src/extraction/structurer.js';

const archivos = process.argv.slice(2);
const objetivos = archivos.length
  ? archivos
  : [
      'test-assets/factura-01-limpia.png',
      'test-assets/factura-02-escaneada.png',
      'test-assets/factura-03-degradada.png'
    ];

function c(campo) {
  if (!campo) return 'n/a';
  const v = campo.valor === null ? 'null' : JSON.stringify(campo.valor);
  const flags = [];
  if (campo.needs_review) flags.push('REVISAR');
  if (campo.verificado_en_ocr === false && campo.valor !== null) flags.push('NO-EN-OCR');
  return `${v} (conf ${campo.confianza}${flags.length ? ', ' + flags.join('+') : ''})`;
}

const latencias = [];

for (const archivo of objetivos) {
  console.log('');
  console.log('#'.repeat(80));
  console.log(`# ${archivo}`);
  console.log('#'.repeat(80));
  try {
    const f = await extraerFactura(archivo);
    latencias.push({ archivo, ...f.extraccion });

    console.log(`proveedor        : ${c(f.proveedor.nombre)}`);
    console.log(`id fiscal        : ${c(f.proveedor.identificacion_fiscal)}`);
    console.log(`numero factura   : ${c(f.numero_factura)}`);
    console.log(`fecha            : ${c(f.fecha)}`);
    console.log(`moneda           : ${c(f.moneda)}`);
    console.log(`orden compra ref : ${c(f.orden_compra_referencia)}`);
    console.log(`subtotal         : ${c(f.totales.subtotal)}`);
    console.log(`impuestos        : ${c(f.totales.impuestos)}`);
    console.log(`TOTAL FACTURA    : ${c(f.totales.total_factura)}`);
    console.log(`items (${f.items.length}):`);
    for (const it of f.items) {
      console.log(`  L${it.linea} cod=${c(it.codigo)}`);
      console.log(`       nombre=${c(it.nombre)}`);
      console.log(`       cant=${c(it.cantidad)}  precio=${c(it.precio_unitario)}  total=${c(it.total)}`);
    }
    console.log(`needs_review global : ${f.needs_review}`);
    console.log(`confianza global    : ${f.confianza_global}`);
    console.log(`campos inseguros declarados por el modelo: ${JSON.stringify(f.extraccion.campos_inseguros_declarados)}`);
    if (f.extraccion.advertencias.length) {
      console.log('advertencias:');
      for (const a of f.extraccion.advertencias) console.log(`  - ${a}`);
    }
    console.log(
      `latencia: OCR ${f.extraccion.ocr.duracion_ms} ms + LLM ${f.extraccion.llm.duracion_ms} ms ` +
        `= ${f.extraccion.duracion_total_ms} ms  (${f.extraccion.llm.tokens_por_segundo?.toFixed(1) ?? '?'} tok/s, ` +
        `backend ${f.extraccion.llm.backend})`
    );
  } catch (error) {
    console.log(`FALLO [${error.codigo ?? error.name}]: ${error.message}`);
  }
}

console.log('');
console.log('='.repeat(80));
console.log('RESUMEN DE LATENCIA');
for (const l of latencias) {
  console.log(
    `  ${l.archivo.padEnd(42)} OCR ${String(l.ocr.duracion_ms).padStart(6)} ms | ` +
      `LLM ${String(l.llm.duracion_ms).padStart(6)} ms | total ${String(l.duracion_total_ms).padStart(6)} ms`
  );
}

await liberarModeloOcr().catch(() => {});
await liberarModeloEstructurador().catch(() => {});
const { close } = await import('@qvac/sdk');
await close();
