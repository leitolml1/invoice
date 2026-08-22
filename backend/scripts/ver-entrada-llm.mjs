/**
 * Muestra el texto EXACTO que recibe el LLM, desde el cache de OCR.
 * Sirve para verificar el fix del Bug 1 sin pagar inferencia.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { aCeldas, agruparEnFilas, estimarInclinacion } from '../src/extraction/layout.js';
import { reconstruirTabla, construirEntradaLlm } from '../src/extraction/table.js';

const objetivos = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'test-assets/factura-01-limpia.png',
      'test-assets/factura-02-escaneada.png',
      'test-assets/factura-03-degradada.png'
    ];

for (const imagen of objetivos) {
  const cache = path.join('.ocr-cache', `${path.basename(imagen)}.json`);
  const bloques = JSON.parse(await readFile(cache, 'utf8'));
  const celdas = aCeldas(bloques);

  const filasCrudas = agruparEnFilas(celdas);
  const tablaCruda = reconstruirTabla(filasCrudas);
  let pendiente = 0;
  if (tablaCruda.encabezado) {
    const celdasEnc = filasCrudas[tablaCruda.encabezado.indice].celdas.filter((c) =>
      tablaCruda.encabezado.columnas.some((col) => col.x1 === c.x1 && col.x2 === c.x2)
    );
    pendiente = estimarInclinacion(celdasEnc);
  }
  const filas = pendiente !== 0 ? agruparEnFilas(celdas, { pendiente }) : filasCrudas;
  const tabla = pendiente !== 0 ? reconstruirTabla(filas) : tablaCruda;

  console.log('='.repeat(78));
  console.log(imagen);
  console.log('='.repeat(78));
  const entrada = construirEntradaLlm(filas, tabla);
  console.log(entrada);
  console.log(`\n[${entrada.length} caracteres]`);
  const conCoordenadas = /@x\d+/.test(entrada);
  console.log(`[anotaciones @xN presentes: ${conCoordenadas ? 'SI (BUG 1 SIGUE)' : 'no'}]`);
  console.log('');
}
