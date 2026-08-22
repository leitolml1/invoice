/**
 * Estructurador: convierte el texto que devolvio el OCR en JSON, usando un LLM
 * local (1-4B, Q4) via @qvac/sdk. Inferencia 100% local.
 *
 * API usada (verificada en la doc https://docs.qvac.tether.io/ai-capabilities/text-generation/
 * y contra el paquete instalado):
 *
 *   loadModel({ modelSrc: QWEN3_1_7B_INST_Q4.src, modelType: MODEL_TYPES.llm,
 *               modelConfig: { ctx_size } }) -> Promise<string>
 *   completion({ modelId, history, stream }) -> CompletionRun { events, final }
 *     final: { contentText, thinkingText, toolCalls, stats, stopReason, raw }
 *   unloadModel({ modelId, clearStorage })
 *
 * Nota medida en esta maquina: Qwen3 emite bloques <think> por defecto y gasta
 * cientos de tokens razonando (21 s para un JSON de 2 campos). Se desactiva con
 * el sufijo "/no_think" en el mensaje, y ademas se limpian los <think> por si
 * el modelo los emite igual.
 */

import { ErrorModelo, ErrorExtraccion } from './errors.js';

/** @type {{ modelId: string, nombre: string }|null} */
let cacheModelo = null;
/** @type {Promise<{ modelId: string, nombre: string }>|null} */
let cargaEnCurso = null;

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

/** Modelos admitidos para estructurar, todos 1-4B cuantizados a Q4. */
export const MODELOS_ESTRUCTURADOR = Object.freeze({
  'qwen3-1.7b-q4': 'QWEN3_1_7B_INST_Q4',
  'qwen3-4b-q4': 'QWEN3_4B_INST_Q4_K_M',
  'llama3.2-1b-q4': 'LLAMA_3_2_1B_INST_Q4_0'
});

export const CONFIG_LLM_POR_DEFECTO = Object.freeze({
  modelo: 'qwen3-1.7b-q4',
  ctx_size: 8192,
  intentos: 2
});

/**
 * Instruccion del sistema. La regla 1 es la que pide el enunciado: el modelo
 * debe declarar inseguridad en vez de inventar un valor.
 */
const INSTRUCCIONES = `Sos un extractor de datos de facturas. Recibis el texto de una factura leido por OCR, una linea por fila del documento. Cada celda viene como TEXTO@xN, donde N es la coordenada horizontal en pixeles: te sirve para saber que celdas pertenecen a la misma columna en filas distintas.

Devolve UNICAMENTE un objeto JSON valido. Sin explicaciones, sin markdown, sin bloques de codigo.

Forma exacta del JSON:
{
  "proveedor": string|null,
  "identificacion_fiscal": string|null,
  "numero_factura": string|null,
  "fecha": string|null,
  "moneda": string|null,
  "orden_compra_referencia": string|null,
  "items": [
    {"codigo": string|null, "nombre": string|null, "cantidad": number|null,
     "unidad": string|null, "precio_unitario": number|null, "total": number|null}
  ],
  "subtotal": number|null,
  "impuestos": number|null,
  "total_factura": number|null,
  "campos_inseguros": [string]
}

REGLAS CRITICAS, en orden de prioridad:
1. NUNCA inventes un valor. Si un dato no aparece en el texto, o aparece cortado, borroso o ambiguo, poné null y agregá el nombre del campo en "campos_inseguros". Es correcto y esperado devolver null.
2. Copiá los numeros EXACTAMENTE como figuran en el texto. No recalcules, no completes digitos que falten, no redondees, no corrijas.
3. Si la cantidad de un item no aparece en su fila, poné "cantidad": null y agregá "items[N].cantidad" a campos_inseguros. NO la deduzcas dividiendo el importe por el precio unitario.
4. Una fila de la tabla es un item. No fusiones dos items en uno ni partas uno en dos.
5. En "campos_inseguros" usá el nombre del campo de nivel superior (ej: "fecha") o la ruta del item (ej: "items[0].cantidad").
6. Los importes van como numero sin simbolo de moneda ni separador de miles: 1026.00, no "$ 1.026,00".`;

/**
 * Carga (o reusa) el modelo del estructurador.
 * @param {object} [opciones]
 * @param {string} [opciones.modelo] clave de MODELOS_ESTRUCTURADOR
 * @param {number} [opciones.ctx_size]
 * @param {(p: object) => void} [opciones.onProgress]
 * @returns {Promise<string>} modelId
 */
export async function cargarModeloEstructurador(opciones = {}) {
  const sdk = await cargarSdk();
  const claveModelo = opciones.modelo ?? CONFIG_LLM_POR_DEFECTO.modelo;
  const nombreConstante = MODELOS_ESTRUCTURADOR[claveModelo];
  if (!nombreConstante) {
    throw new ErrorModelo(
      `Modelo "${claveModelo}" no reconocido. Opciones: ${Object.keys(MODELOS_ESTRUCTURADOR).join(', ')}`
    );
  }
  const descriptor = sdk[nombreConstante];
  if (!descriptor?.src) {
    throw new ErrorModelo(
      `@qvac/sdk no exporta la constante ${nombreConstante} (version instalada incompatible).`
    );
  }

  if (cacheModelo?.nombre === nombreConstante) return cacheModelo.modelId;
  if (cargaEnCurso) {
    const previa = await cargaEnCurso;
    if (previa.nombre === nombreConstante) return previa.modelId;
  }

  cargaEnCurso = (async () => {
    if (cacheModelo) {
      try {
        await sdk.unloadModel({ modelId: cacheModelo.modelId, clearStorage: false });
      } catch { /* seguimos */ }
      cacheModelo = null;
    }
    try {
      const modelId = await sdk.loadModel({
        modelSrc: descriptor.src,
        modelType: sdk.MODEL_TYPES.llm,
        modelConfig: { ctx_size: opciones.ctx_size ?? CONFIG_LLM_POR_DEFECTO.ctx_size },
        ...(opciones.onProgress ? { onProgress: opciones.onProgress } : {})
      });
      cacheModelo = { modelId, nombre: nombreConstante };
      return cacheModelo;
    } catch (error) {
      throw new ErrorModelo(
        `No se pudo cargar el modelo ${nombreConstante}: ${error?.message ?? error}`,
        { causa: error?.message }
      );
    }
  })();

  try {
    return (await cargaEnCurso).modelId;
  } finally {
    cargaEnCurso = null;
  }
}

/**
 * Quita bloques de razonamiento y cercas de markdown.
 * @param {string} texto
 * @returns {string}
 */
export function limpiarSalida(texto) {
  return String(texto ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
}

/**
 * Extrae el primer objeto JSON balanceado del texto.
 * @param {string} texto
 * @returns {object|null}
 */
export function extraerJson(texto) {
  const limpio = limpiarSalida(texto);
  const inicio = limpio.indexOf('{');
  if (inicio < 0) return null;

  let profundidad = 0;
  let enCadena = false;
  let escapado = false;
  for (let i = inicio; i < limpio.length; i++) {
    const c = limpio[i];
    if (enCadena) {
      if (escapado) escapado = false;
      else if (c === '\\') escapado = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') enCadena = true;
    else if (c === '{') profundidad++;
    else if (c === '}') {
      profundidad--;
      if (profundidad === 0) {
        try {
          return JSON.parse(limpio.slice(inicio, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Pide al modelo el JSON estructurado a partir del texto tabular del OCR.
 *
 * @param {string} textoTabla salida de layout.filasATexto()
 * @param {object} [opciones]
 * @param {string} [opciones.modelo]
 * @param {number} [opciones.ctx_size]
 * @param {number} [opciones.intentos]
 * @returns {Promise<{ datos: object, duracion_ms: number, stats: object|undefined, intentos_usados: number, salida_cruda: string }>}
 */
export async function estructurar(textoTabla, opciones = {}) {
  const sdk = await cargarSdk();
  const modelId = await cargarModeloEstructurador(opciones);
  const maxIntentos = opciones.intentos ?? CONFIG_LLM_POR_DEFECTO.intentos;

  const inicio = Date.now();
  let ultimaSalida = '';
  let ultimasStats;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    const refuerzo =
      intento === 1
        ? ''
        : '\n\nATENCION: tu respuesta anterior no era JSON valido. Respondé unicamente con el objeto JSON, empezando con { y terminando con }.';

    const history = [
      {
        role: 'user',
        content:
          `${INSTRUCCIONES}${refuerzo}\n\n` +
          `Texto de la factura leido por OCR:\n<<<\n${textoTabla}\n>>>\n\n/no_think`
      }
    ];

    let run;
    try {
      run = sdk.completion({ modelId, history, stream: true });
    } catch (error) {
      throw new ErrorModelo(`Fallo la inferencia del estructurador: ${error?.message ?? error}`, {
        causa: error?.message
      });
    }

    // Consumimos el stream para que `final` resuelva.
    for await (const evento of run.events) {
      if (evento.type === 'completionDone' && evento.stopReason === 'error') {
        throw new ErrorModelo(
          `La inferencia termino con error: ${evento.error?.message ?? 'sin detalle'}`
        );
      }
    }
    const final = await run.final;
    ultimaSalida = final.contentText ?? '';
    ultimasStats = final.stats;

    const datos = extraerJson(ultimaSalida);
    if (datos && typeof datos === 'object') {
      return {
        datos,
        duracion_ms: Date.now() - inicio,
        stats: ultimasStats,
        intentos_usados: intento,
        salida_cruda: ultimaSalida
      };
    }
  }

  throw new ErrorExtraccion(
    `El modelo no devolvio JSON valido despues de ${maxIntentos} intentos.`,
    { codigo: 'JSON_INVALIDO', salida_cruda: ultimaSalida.slice(0, 1000) }
  );
}

/**
 * Libera el modelo del estructurador.
 * @returns {Promise<void>}
 */
export async function liberarModeloEstructurador() {
  if (!cacheModelo) return;
  const sdk = await cargarSdk();
  try {
    await sdk.unloadModel({ modelId: cacheModelo.modelId, clearStorage: false });
  } finally {
    cacheModelo = null;
  }
}
