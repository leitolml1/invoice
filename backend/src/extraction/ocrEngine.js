/**
 * Motor de OCR sobre @qvac/sdk. Inferencia 100% local.
 *
 * API usada (verificada en node_modules/@qvac/sdk/dist/client/api/ocr.d.ts y en
 * https://docs.qvac.tether.io/ai-capabilities/ocr/):
 *
 *   loadModel({ modelSrc: OCR_LATIN.src, modelType: MODEL_TYPES.ggmlOcr, modelConfig })
 *     -> Promise<string> (modelId). El detector CRAFT se deriva solo.
 *   ocr({ modelId, image, options }) -> { blockStream, blocks, stats }
 *     blocks: Promise<{ text, bbox?: [x1,y1,x2,y2], confidence? }[]>
 *   unloadModel({ modelId, clearStorage })
 *
 * Los modelos se cargan una sola vez por proceso y se reusan: cargar cuesta
 * entre 6 y 10 s en frio, y no queremos pagarlo en cada request HTTP.
 */

import { ErrorModelo } from './errors.js';

/** @type {{ modelId: string, clave: string }|null} */
let cacheModelo = null;
/** @type {Promise<{ modelId: string, clave: string }>|null} */
let cargaEnCurso = null;

/**
 * Importa el SDK. Se hace dinamico para que el resto del backend (Capa 1) siga
 * funcionando aunque @qvac/sdk no este instalado.
 * @returns {Promise<any>}
 */
async function cargarSdk() {
  try {
    return await import('@qvac/sdk');
  } catch (error) {
    throw new ErrorModelo(
      'No se pudo cargar @qvac/sdk. Instalalo con "npm install @qvac/sdk" en backend/.',
      { causa: error?.message }
    );
  }
}

/**
 * Config por defecto del OCR.
 *
 * magRatio y defaultRotationAngles estan calibrados con mediciones en esta
 * maquina (AMD Ryzen 5 5500U, iGPU via Vulkan) sobre una factura de 1000x1150:
 *   - default del SDK ............................ 52,0 s (deteccion 45,5 s)
 *   - magRatio 1.0 + defaultRotationAngles [] .... 21,1 s (deteccion 16,7 s)
 *   - magRatio 0.7 + defaultRotationAngles [] .... 10,5 s (deteccion  6,7 s)
 * Se eligio 1.0 como equilibrio entre latencia y no perder texto chico.
 * Las rotaciones se desactivan porque cuadruplican la deteccion y las facturas
 * escaneadas llegan derechas o con inclinacion de pocos grados.
 */
export const CONFIG_OCR_POR_DEFECTO = Object.freeze({
  langList: ['en'],
  magRatio: 1.0,
  defaultRotationAngles: [],
  contrastRetry: false,
  lowConfidenceThreshold: 0.5,
  recognizerBatchSize: 8
});

/**
 * Carga (o reusa) el modelo de OCR.
 *
 * @param {object} [opciones]
 * @param {object} [opciones.modelConfig] overrides de CONFIG_OCR_POR_DEFECTO
 * @param {(p: {percentage: number, downloaded: number, total: number}) => void} [opciones.onProgress]
 * @returns {Promise<string>} modelId
 */
export async function cargarModeloOcr(opciones = {}) {
  const sdk = await cargarSdk();
  const modelConfig = { ...CONFIG_OCR_POR_DEFECTO, ...(opciones.modelConfig ?? {}) };
  const clave = JSON.stringify(modelConfig);

  if (cacheModelo && cacheModelo.clave === clave) return cacheModelo.modelId;
  if (cargaEnCurso) {
    const previa = await cargaEnCurso;
    if (previa.clave === clave) return previa.modelId;
  }

  cargaEnCurso = (async () => {
    // Si habia otro modelo con config distinta, lo liberamos.
    if (cacheModelo) {
      try {
        await sdk.unloadModel({ modelId: cacheModelo.modelId, clearStorage: false });
      } catch {
        /* si falla el unload seguimos: el proceso va a terminar igual */
      }
      cacheModelo = null;
    }
    try {
      const modelId = await sdk.loadModel({
        modelSrc: sdk.OCR_LATIN.src,
        modelType: sdk.MODEL_TYPES.ggmlOcr,
        modelConfig,
        ...(opciones.onProgress ? { onProgress: opciones.onProgress } : {})
      });
      cacheModelo = { modelId, clave };
      return cacheModelo;
    } catch (error) {
      throw new ErrorModelo(`No se pudo cargar el modelo de OCR: ${error?.message ?? error}`, {
        causa: error?.message
      });
    }
  })();

  try {
    const resultado = await cargaEnCurso;
    return resultado.modelId;
  } finally {
    cargaEnCurso = null;
  }
}

/**
 * Corre OCR sobre una imagen.
 *
 * Se usa `paragraph: false` a proposito: con `paragraph: true` el propio OCR
 * fusiona filas distintas de la tabla de items en un unico bloque (verificado
 * en esta maquina), lo que destruye la estructura. Agrupamos nosotros por bbox
 * en extraction/layout.js.
 *
 * @param {string|Buffer} imagen ruta o buffer
 * @param {object} [opciones]
 * @param {object} [opciones.modelConfig]
 * @returns {Promise<{ bloques: import('./layout.js').BloqueOcr[], stats: object|undefined, duracion_ms: number, modelId: string }>}
 */
export async function ejecutarOcr(imagen, opciones = {}) {
  const sdk = await cargarSdk();
  const modelId = await cargarModeloOcr(opciones);

  const inicio = Date.now();
  try {
    const run = sdk.ocr({ modelId, image: imagen, options: { paragraph: false } });
    const bloques = await run.blocks;
    const stats = await run.stats;
    return { bloques, stats, duracion_ms: Date.now() - inicio, modelId };
  } catch (error) {
    throw new ErrorModelo(`El OCR fallo al procesar la imagen: ${error?.message ?? error}`, {
      codigo: 'OCR_FALLIDO',
      causa: error?.message
    });
  }
}

/**
 * Libera el modelo de OCR.
 * @returns {Promise<void>}
 */
export async function liberarModeloOcr() {
  if (!cacheModelo) return;
  const sdk = await cargarSdk();
  try {
    await sdk.unloadModel({ modelId: cacheModelo.modelId, clearStorage: false });
  } finally {
    cacheModelo = null;
  }
}
