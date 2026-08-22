/**
 * Prueba la reconstruccion determinisitica de la tabla (bandas de X) sin
 * volver a correr el LLM, y cacheando el OCR en disco.
 *
 * El cache existe para poder iterar: el OCR tarda entre 20 y 40 s por factura
 * mas la carga del modelo, y la logica de bandas no depende de nada de eso.
 *
 * Uso: node scripts/probar-tabla.mjs [--refrescar] [imagen...]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ejecutarOcr, liberarModeloOcr } from '../src/extraction/ocrEngine.js';
import { aCeldas, agruparEnFilas, estimarInclinacion } from '../src/extraction/layout.js';
import { reconstruirTabla, tablaItemsATexto, ROLES } from '../src/extraction/table.js';

const DIR_CACHE = '.ocr-cache';
const args = process.argv.slice(2);
const refrescar = args.includes('--refrescar');
const imagenes = args.filter((a) => !a.startsWith('--'));
const objetivos = imagenes.length
  ? imagenes
  : [
      'test-assets/factura-01-limpia.png',
      'test-assets/factura-02-escaneada.png',
      'test-assets/factura-03-degradada.png'
    ];

let usoOcr = false;

async function bloquesDe(imagen) {
  const cache = path.join(DIR_CACHE, `${path.basename(imagen)}.json`);
  if (!refrescar) {
    try {
      return JSON.parse(await readFile(cache, 'utf8'));
    } catch {
      /* sin cache, seguimos al OCR */
    }
  }
  usoOcr = true;
  const r = await ejecutarOcr(imagen);
  await mkdir(DIR_CACHE, { recursive: true });
  await writeFile(cache, JSON.stringify(r.bloques, null, 1));
  console.log(`  (OCR real: ${r.duracion_ms} ms, cacheado en ${cache})`);
  return r.bloques;
}

for (const imagen of objetivos) {
  console.log('');
  console.log('='.repeat(78));
  console.log(imagen);
  console.log('='.repeat(78));

  const bloques = await bloquesDe(imagen);
  const celdas = aCeldas(bloques);

  // Pasada 1: agrupar sin correccion, solo para ubicar el encabezado.
  const filasCrudas = agruparEnFilas(celdas);
  const tablaCruda = reconstruirTabla(filasCrudas);

  // Pendiente estimada sobre las celdas del encabezado, que son una linea real.
  let pendiente = 0;
  if (tablaCruda.encabezado) {
    const celdasEnc = filasCrudas[tablaCruda.encabezado.indice].celdas.filter((c) =>
      tablaCruda.encabezado.columnas.some((col) => col.x1 === c.x1 && col.x2 === c.x2)
    );
    pendiente = estimarInclinacion(celdasEnc);
  }

  // Pasada 2: reagrupar corrigiendo la inclinacion.
  const filas = pendiente !== 0 ? agruparEnFilas(celdas, { pendiente }) : filasCrudas;
  const tabla = reconstruirTabla(filas);

  console.log(`celdas: ${celdas.length}`);
  console.log(`filas sin corregir: ${filasCrudas.length}   items detectados: ${tablaCruda.items.length}`);
  console.log(`pendiente estimada: ${pendiente.toFixed(5)}`);
  console.log(`filas corregidas:   ${filas.length}   items detectados: ${tabla.items.length}`);

  if (!tabla.encabezado) {
    console.log('NO SE DETECTO ENCABEZADO DE TABLA');
    continue;
  }

  console.log('\nencabezado detectado:');
  for (const col of tabla.encabezado.columnas) {
    console.log(`  ${col.rol.padEnd(16)} "${col.texto}"  x ${col.x1}-${col.x2}`);
  }

  console.log('\nbandas:');
  for (const b of tabla.bandas) {
    const d = b.desde === -Infinity ? '  -inf' : b.desde.toFixed(0).padStart(6);
    const h = b.hasta === Infinity ? '+inf  ' : b.hasta.toFixed(0).padEnd(6);
    console.log(`  ${b.rol.padEnd(16)} ${d} .. ${h}`);
  }

  console.log('\ntabla de items reconstruida:');
  console.log(
    tablaItemsATexto(tabla.items, tabla.bandas)
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n')
  );

  // Chequeo aritmetico como senal de calidad, sin tocar nada.
  console.log('\nverificacion cantidad x precio = total:');
  for (const [i, item] of tabla.items.entries()) {
    const q = Number.parseFloat(item.valores.cantidad ?? '');
    const p = Number.parseFloat(item.valores.precio_unitario ?? '');
    const t = Number.parseFloat(item.valores.total ?? '');
    if (!Number.isFinite(q) || !Number.isFinite(p) || !Number.isFinite(t)) {
      const faltan = ROLES.filter((r) => !item.valores[r]);
      console.log(`  L${i + 1}: incompleto (sin ${faltan.join(', ') || 'datos'})`);
      continue;
    }
    const ok = Math.abs(q * p - t) < 0.02;
    console.log(`  L${i + 1}: ${q} x ${p} = ${(q * p).toFixed(2)} vs ${t.toFixed(2)}  ${ok ? 'OK' : 'NO COINCIDE'}`);
  }
}

if (usoOcr) {
  await liberarModeloOcr().catch(() => {});
  const { close } = await import('@qvac/sdk');
  await close();
}
