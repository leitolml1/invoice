/**
 * Volca los bloques de OCR tal como los va a recibir el estructurador,
 * para poder juzgar la precision real antes de fijar la config.
 */
import { loadModel, ocr, unloadModel, close, OCR_LATIN, MODEL_TYPES } from '@qvac/sdk';
import process from 'node:process';

const imagen = process.argv[2] ?? 'test-assets/factura-01-limpia.png';
const magRatio = Number(process.argv[3] ?? 1.0);

let modelId = null;
try {
  modelId = await loadModel({
    modelSrc: OCR_LATIN.src,
    modelType: MODEL_TYPES.ggmlOcr,
    modelConfig: {
      langList: ['en'],
      magRatio,
      defaultRotationAngles: [],
      contrastRetry: false,
      recognizerBatchSize: 8
    }
  });
  const run = ocr({ modelId, image: imagen, options: { paragraph: true } });
  const blocks = await run.blocks;
  console.log(`### ${imagen}  magRatio=${magRatio}  ${blocks.length} bloques`);
  for (const b of blocks) {
    const c = b.confidence === undefined ? 's/d' : b.confidence.toFixed(2);
    const box = b.bbox ? `(${b.bbox.map((n) => Math.round(n)).join(',')})` : '(sin bbox)';
    console.log(`[${c}] ${box} ${JSON.stringify(b.text)}`);
  }
} catch (e) {
  console.error('FALLO:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  try { if (modelId) await unloadModel({ modelId, clearStorage: false }); } catch {}
  await close();
}
