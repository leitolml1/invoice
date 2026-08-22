/**
 * Volca los bloques de OCR con la MISMA config que usa produccion
 * (paragraph: false + CONFIG_OCR_POR_DEFECTO), y ademas muestra las filas
 * reconstruidas por layout.js y el texto tabular que recibe el LLM.
 *
 * Es la foto exacta de la entrada del estructurador, que es donde viven los
 * dos bugs. Uso: node scripts/dump-ocr-prod.mjs [imagen] [magRatio]
 */
import process from 'node:process';
import { ejecutarOcr, liberarModeloOcr } from '../src/extraction/ocrEngine.js';
import { aCeldas, agruparEnFilas, filasATexto } from '../src/extraction/layout.js';

const imagen = process.argv[2] ?? 'test-assets/factura-01-limpia.png';
const magRatio = process.argv[3] ? Number(process.argv[3]) : undefined;

try {
  const r = await ejecutarOcr(imagen, {
    modelConfig: magRatio === undefined ? undefined : { magRatio }
  });
  const celdas = aCeldas(r.bloques);
  const filas = agruparEnFilas(celdas);

  console.log(`### ${imagen}  magRatio=${magRatio ?? 'default(1.0)'}  paragraph=false`);
  console.log(`### ${celdas.length} celdas -> ${filas.length} filas   OCR ${r.duracion_ms} ms\n`);

  console.log('--- CELDAS CON BBOX [x1,y1,x2,y2] ---');
  for (const c of celdas) {
    console.log(
      `[${c.confianza.toFixed(2)}] (${c.x1},${c.y1},${c.x2},${c.y2})`.padEnd(30) +
        ` cx=${String(Math.round((c.x1 + c.x2) / 2)).padStart(4)}  ${JSON.stringify(c.texto)}`
    );
  }

  console.log('\n--- FILAS RECONSTRUIDAS (y = centro vertical) ---');
  for (const f of filas) {
    const celdasTxt = f.celdas
      .map((c) => `${JSON.stringify(c.texto)}@[${c.x1}-${c.x2}]`)
      .join('  ');
    console.log(`y=${String(f.y).padStart(4)}  ${celdasTxt}`);
  }

  console.log('\n--- TEXTO TABULAR QUE RECIBE EL LLM (filasATexto) ---');
  console.log(filasATexto(filas));
} catch (e) {
  console.error('FALLO:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await liberarModeloOcr().catch(() => {});
  const { close } = await import('@qvac/sdk');
  await close();
}
