/**
 * Smoke test del paso 1: confirma que el OCR de @qvac/sdk carga y corre local.
 *
 * API usada (verificada contra node_modules/@qvac/sdk/dist/client/api/ocr.d.ts):
 *   loadModel({ modelSrc: OCR_LATIN.src, modelType: MODEL_TYPES.ggmlOcr })
 *   ocr({ modelId, image, options }) -> { blockStream, blocks, stats }
 *   unloadModel({ modelId }) / close()
 *
 * Uso: node scripts/smoke-ocr.mjs [ruta-imagen]
 */
import { loadModel, ocr, unloadModel, close, OCR_LATIN, MODEL_TYPES } from '@qvac/sdk';
import path from 'node:path';
import process from 'node:process';

const imagen = process.argv[2] ?? path.join(process.cwd(), 'test-assets', 'factura-01-limpia.png');

let modelId = null;
try {
  console.log(`> modelo OCR: ${OCR_LATIN.name} (${(OCR_LATIN.expectedSize / 1e6).toFixed(1)} MB)`);
  const t0 = Date.now();
  modelId = await loadModel({
    modelSrc: OCR_LATIN.src,
    modelType: MODEL_TYPES.ggmlOcr,
    onProgress: (p) => {
      const mb = (n) => (n / 1e6).toFixed(1);
      process.stderr.write(`\r  descargando ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)   `);
      if (p.percentage >= 100) process.stderr.write('\n');
    }
  });
  console.log(`> modelo cargado en ${Date.now() - t0} ms  (id=${modelId})`);

  console.log(`> OCR sobre ${imagen}`);
  const t1 = Date.now();
  const run = ocr({ modelId, image: imagen, options: { paragraph: false } });
  const blocks = await run.blocks;
  const stats = await run.stats;
  const ms = Date.now() - t1;

  console.log(`> ${blocks.length} bloques en ${ms} ms`);
  console.log(`> stats: ${JSON.stringify(stats)}`);
  console.log('');
  for (const b of blocks) {
    const conf = b.confidence === undefined ? 's/d' : b.confidence.toFixed(3);
    console.log(`  [${conf}] ${JSON.stringify(b.text)}`);
  }
} catch (error) {
  console.error('');
  console.error('FALLO:', error?.message ?? error);
  if (error?.stack) console.error(error.stack.split('\n').slice(1, 5).join('\n'));
  process.exitCode = 1;
} finally {
  try {
    if (modelId) await unloadModel({ modelId, clearStorage: false });
  } catch {}
  await close();
}
