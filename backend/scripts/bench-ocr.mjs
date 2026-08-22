/**
 * Mide el impacto de modelConfig en la latencia de deteccion del OCR.
 * modelConfig segun el ejemplo de https://docs.qvac.tether.io/ai-capabilities/ocr/
 */
import { loadModel, ocr, unloadModel, close, OCR_LATIN, MODEL_TYPES } from '@qvac/sdk';
import process from 'node:process';

const imagen = process.argv[2] ?? 'test-assets/factura-01-limpia.png';

const configs = [
  ['default (sin modelConfig)', undefined],
  ['magRatio 1.0, sin rotaciones', { langList: ['en'], magRatio: 1.0, defaultRotationAngles: [], contrastRetry: false, recognizerBatchSize: 8 }],
  ['magRatio 0.7, sin rotaciones', { langList: ['en'], magRatio: 0.7, defaultRotationAngles: [], contrastRetry: false, recognizerBatchSize: 8 }]
];

for (const [etiqueta, modelConfig] of configs) {
  let modelId = null;
  try {
    modelId = await loadModel({
      modelSrc: OCR_LATIN.src,
      modelType: MODEL_TYPES.ggmlOcr,
      ...(modelConfig ? { modelConfig } : {})
    });
    const t = Date.now();
    const run = ocr({ modelId, image: imagen, options: { paragraph: true } });
    const blocks = await run.blocks;
    const stats = await run.stats;
    const bajas = blocks.filter((b) => (b.confidence ?? 1) < 0.7).length;
    console.log(
      `${etiqueta.padEnd(32)} | ${String(Date.now() - t).padStart(6)} ms | ` +
        `det ${(stats?.detectionTime ?? 0).toFixed(1)}s rec ${(stats?.recognitionTime ?? 0).toFixed(1)}s | ` +
        `${blocks.length} bloques, ${bajas} con conf<0.7`
    );
  } catch (error) {
    console.log(`${etiqueta.padEnd(32)} | FALLO: ${error?.message ?? error}`);
  } finally {
    try { if (modelId) await unloadModel({ modelId, clearStorage: false }); } catch {}
  }
}
await close();
