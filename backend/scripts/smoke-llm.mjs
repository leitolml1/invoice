/**
 * Smoke test del estructurador: confirma que un LLM 1-4B Q4 carga en esta
 * maquina y devuelve JSON, y mide la latencia.
 *
 * API verificada en la doc (ai-capabilities/text-generation) y en el .d.ts:
 *   loadModel({ modelSrc, modelType, modelConfig }) -> modelId
 *   completion({ modelId, history, stream }) -> { events, final }
 */
import { loadModel, completion, unloadModel, close, getSystemResources, QWEN3_1_7B_INST_Q4, MODEL_TYPES } from '@qvac/sdk';
import os from 'node:os';
import process from 'node:process';

const libreGb = () => ((os.availableMemory?.() ?? os.freemem()) / 1e9).toFixed2 ?? 0;
const gb = (n) => (n / 1e9).toFixed(2);

console.log(`RAM libre antes de cargar: ${gb(os.availableMemory?.() ?? os.freemem())} GB`);
console.log(`modelo: ${QWEN3_1_7B_INST_Q4.name} (${gb(QWEN3_1_7B_INST_Q4.expectedSize)} GB en disco)`);

let modelId = null;
try {
  const t0 = Date.now();
  modelId = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4.src,
    modelType: MODEL_TYPES.llm,
    modelConfig: { ctx_size: 4096 },
    onProgress: (p) => {
      process.stderr.write(`\r  descargando ${p.percentage.toFixed(0)}%   `);
      if (p.percentage >= 100) process.stderr.write('\n');
    }
  });
  console.log(`modelo cargado en ${Date.now() - t0} ms`);
  console.log(`RAM libre despues de cargar: ${gb(os.availableMemory?.() ?? os.freemem())} GB`);

  try {
    const r = await getSystemResources();
    console.log(`getSystemResources -> ${JSON.stringify(r).slice(0, 300)}`);
  } catch (e) {
    console.log(`getSystemResources no disponible: ${e?.message}`);
  }

  const t1 = Date.now();
  const run = completion({
    modelId,
    history: [
      {
        role: 'user',
        content:
          'Devolve SOLO un objeto JSON valido, sin texto alrededor y sin bloques de codigo, ' +
          'con esta forma exacta: {"proveedor":"...","total":0}\n\n' +
          'Texto de la factura:\nDistribuidora del Sur SA\nTOTAL: 1986.82\n'
      }
    ],
    stream: true
  });
  for await (const ev of run.events) {
    if (ev.type === 'contentDelta') process.stdout.write(ev.text);
  }
  const final = await run.final;
  const ms = Date.now() - t1;
  console.log('');
  console.log(`--- inferencia en ${ms} ms ---`);
  console.log(`contentText: ${JSON.stringify(final.contentText)}`);
  console.log(`stopReason: ${final.stopReason}`);
  console.log(`stats: ${JSON.stringify(final.stats)}`);
} catch (error) {
  console.error('');
  console.error('FALLO:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  try { if (modelId) await unloadModel({ modelId, clearStorage: false }); } catch {}
  await close();
}
