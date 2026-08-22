#!/usr/bin/env node
/**
 * Servidor HTTP de InvoiceGuard. Une el Modulo A (extraccion con QVAC) con el
 * Modulo B (matching determinisitico) y responde el contrato plano del frontend.
 *
 *   POST /reconcile   multipart/form-data, campo "factura" (PNG/JPEG/BMP/PDF)
 *   GET  /health      estado del servidor, la orden de demo y los modelos
 *
 * FLUJO, sin atajos:
 *   imagen -> extraerFactura()          Modulo A: OCR + LLM, 100% local
 *          -> parsearFacturaExtraida()  normalizacion
 *          -> reconciliar()             Modulo B: reglas determinisiticas
 *          -> aplanarResultado()        contrato del frontend
 *
 * NO hay respuesta simulada. No existe ningun camino donde este endpoint
 * devuelva datos sin haber corrido OCR e inferencia reales. La unica variante
 * es OCR_CACHE=1, que reusa bloques de OCR ya calculados para las imagenes de
 * test-assets/ (sigue corriendo el LLM y el matching de verdad); sirve para
 * iterar sobre la UI sin esperar 22 s de deteccion por request.
 *
 * Variables de entorno:
 *   PORT=3001              puerto (el proxy de Vite apunta aca)
 *   ORIGENES=...           origenes CORS separados por coma
 *   ORDEN_DEMO=ruta        orden de compra fija (default data/orden-demo.json)
 *   PRECARGAR=1            carga los modelos al arrancar (el 1er request no espera)
 *   QVAC_SECUENCIAL=1      libera el modelo de OCR antes de invocar el LLM
 *                          (necesario en maquinas donde no conviven en RAM)
 *   OCR_CACHE=1            reusa .ocr-cache/<archivo>.json si existe
 */

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { extraerFactura } from './extraction/extract.js';
import { ejecutarOcr, cargarModeloOcr, liberarModeloOcr } from './extraction/ocrEngine.js';
import { cargarModeloEstructurador } from './extraction/structurer.js';
import { ErrorExtraccion } from './extraction/errors.js';
import { parsearFacturaExtraida } from './schema/invoice.js';
import { parsearOrden } from './schema/order.js';
import { reconciliar } from './matching/engine.js';
import { crearConfig } from './config.js';
import { aplanarResultado } from './api/flatten.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');

const PUERTO = Number(process.env.PORT ?? 3001);
const RUTA_ORDEN = process.env.ORDEN_DEMO
  ? path.resolve(process.env.ORDEN_DEMO)
  : path.join(RAIZ, 'data', 'orden-demo.json');
const SECUENCIAL = process.env.QVAC_SECUENCIAL === '1';
const USAR_CACHE_OCR = process.env.OCR_CACHE === '1';
const ORIGENES = (process.env.ORIGENES ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const config = crearConfig();

// --- Orden de compra fija -----------------------------------------------------
// LIMITACION CONOCIDA del demo: hay una sola orden y es siempre la misma. El
// frontend todavia no manda contra que orden comparar.
let ordenDemo = null;
async function cargarOrdenDemo() {
  const crudo = JSON.parse(await readFile(RUTA_ORDEN, 'utf8'));
  ordenDemo = parsearOrden(crudo, config);
  return ordenDemo;
}

// --- Cola: una inferencia a la vez -------------------------------------------
// El worker de QVAC y los modelos cargados no toleran bien inferencias
// concurrentes en este hardware. Serializamos para no colgar el proceso.
let cola = Promise.resolve();
/**
 * @template T
 * @param {() => Promise<T>} tarea
 * @returns {Promise<T>}
 */
function enFila(tarea) {
  const resultado = cola.then(tarea, tarea);
  cola = resultado.then(
    () => undefined,
    () => undefined
  );
  return resultado;
}

/**
 * Lee bloques de OCR cacheados, si OCR_CACHE=1 y existe el archivo.
 * @param {string|null} nombreArchivo
 * @returns {Promise<object[]|null>}
 */
async function bloquesDesdeCache(nombreArchivo) {
  if (!USAR_CACHE_OCR || !nombreArchivo) return null;
  const ruta = path.join(RAIZ, '.ocr-cache', `${nombreArchivo}.json`);
  try {
    const datos = JSON.parse(await readFile(ruta, 'utf8'));
    const bloques = Array.isArray(datos) ? datos : datos.bloques;
    if (Array.isArray(bloques) && bloques.length) {
      console.log(`  [cache] bloques de OCR reusados desde .ocr-cache/${nombreArchivo}.json`);
      return bloques;
    }
  } catch {
    /* sin cache para este archivo: se corre el OCR real */
  }
  return null;
}

/**
 * Corre el pipeline completo sobre un archivo subido.
 * @param {Buffer} buffer
 * @param {string} nombreArchivo
 * @returns {Promise<object>}
 */
async function procesarFactura(buffer, nombreArchivo) {
  const cacheados = await bloquesDesdeCache(nombreArchivo);

  /** @type {object[]|undefined} */
  let bloquesOcr = cacheados ?? undefined;

  // En modo secuencial corremos el OCR aparte y liberamos su modelo antes de
  // que extraerFactura invoque al LLM.
  if (!bloquesOcr && SECUENCIAL) {
    const salidaOcr = await ejecutarOcr(buffer);
    bloquesOcr = salidaOcr.bloques;
    await liberarModeloOcr().catch(() => {});
  }

  const facturaExtraida = await extraerFactura(buffer, {
    nombreArchivo,
    ...(bloquesOcr ? { bloquesOcr } : {})
  });

  const factura = parsearFacturaExtraida(facturaExtraida, config);
  const resultado = reconciliar({ factura, orden: ordenDemo, config });

  return aplanarResultado(resultado, {
    extraccion: {
      modelo_ocr: facturaExtraida.origen?.modelo_ocr ?? null,
      modelo_estructurador: facturaExtraida.origen?.modelo_estructurador ?? null,
      ocr_ms: facturaExtraida.extraccion?.ocr?.duracion_ms ?? null,
      llm_ms: facturaExtraida.extraccion?.llm?.duracion_ms ?? null,
      total_ms: facturaExtraida.extraccion?.duracion_total_ms ?? null,
      backend_inferencia: facturaExtraida.extraccion?.llm?.backend ?? null,
      bloques_ocr_desde_cache: Boolean(cacheados),
      advertencias: facturaExtraida.extraccion?.advertencias ?? [],
      campos_inseguros: facturaExtraida.extraccion?.campos_inseguros_declarados ?? []
    },
    matching_ms: resultado.trazabilidad?.duracion_ms ?? null
  });
}

// --- App ---------------------------------------------------------------------
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// --- CORS ---------------------------------------------------------------------
// Lista blanca explicita, nunca wildcard ni reflejo del Origin recibido.
//
// Los dos valores por defecto son el mismo servidor de Vite: se sirve en
// 127.0.0.1:5173, y el browser manda ese host literal en el Origin. Dejar solo
// "localhost" haria fallar el flujo real.
//
// Vale aclarar cuando se ejercita esto: en desarrollo el browser pega a
// 127.0.0.1:5173 y Vite reenvia a 3001, asi que la request al backend es
// server-to-server. Pero el POST del browser si lleva Origin (la spec lo exige
// para metodos distintos de GET/HEAD) y el proxy lo reenvia, o sea que la lista
// blanca se evalua de verdad incluso con el proxy en medio.
//
// Para sumar una maquina de la red local durante el demo, se agrega el origen
// concreto por env, separado por comas y con protocolo y puerto:
//   ORIGENES=http://127.0.0.1:5173,http://192.168.1.40:5173 npm start
app.use(
  cors({
    origin: (origen, cb) => {
      // Requests sin cabecera Origin (curl, server-to-server) se permiten: no
      // son de browser, y CORS no es un control de acceso para esos casos.
      if (!origen) return cb(null, true);
      if (ORIGENES.includes(origen)) return cb(null, true);
      cb(new Error(`Origen no permitido: ${origen}`));
    },
    // El unico endpoint que el frontend consume es POST /reconcile.
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
    // No se usan cookies ni Authorization: sin credenciales.
    credentials: false,
    optionsSuccessStatus: 204
  })
);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    servicio: 'invoiceguard-backend',
    orden_demo: ordenDemo
      ? {
          orden_id: ordenDemo.orden_id,
          proveedor: ordenDemo.proveedor.nombre,
          items: ordenDemo.items.length,
          total: ordenDemo.totales.total,
          moneda: ordenDemo.moneda
        }
      : null,
    modo: {
      secuencial: SECUENCIAL,
      cache_ocr: USAR_CACHE_OCR,
      simulado: false
    },
    origenes_permitidos: ORIGENES
  });
});

app.post('/reconcile', upload.single('factura'), async (req, res) => {
  if (!req.file?.buffer?.length) {
    res
      .status(400)
      .type('text/plain')
      .send('Falta el archivo de factura. Enviá un multipart/form-data con el campo "factura".');
    return;
  }
  if (!ordenDemo) {
    res
      .status(503)
      .type('text/plain')
      .send('El servidor todavía no cargó la orden de compra de referencia.');
    return;
  }

  const nombre = req.file.originalname ?? 'factura';
  const inicio = Date.now();
  console.log(`> POST /reconcile  ${nombre}  (${req.file.buffer.length} bytes)`);

  try {
    const respuesta = await enFila(() => procesarFactura(req.file.buffer, nombre));
    console.log(
      `< 200  ${nombre}  ${respuesta.discrepancias.length} discrepancias, ` +
        `estado ${respuesta.meta.estado}, ${Date.now() - inicio} ms`
    );
    res.json(respuesta);
  } catch (error) {
    if (error instanceof ErrorExtraccion) {
      // No se pudo leer la factura o el modelo no esta disponible: 422, con el
      // motivo en texto plano porque el frontend hace response.text().
      console.error(`< 422  ${nombre}  [${error.codigo}] ${error.message}`);
      res.status(422).type('text/plain').send(error.message);
      return;
    }
    console.error(`< 500  ${nombre}  ${error?.stack ?? error}`);
    res
      .status(500)
      .type('text/plain')
      .send(`Error interno procesando la factura: ${error?.message ?? error}`);
  }
});

// Handler de errores de multer y CORS.
app.use((error, _req, res, _next) => {
  const mensaje = error?.message ?? 'Request inválido.';
  let codigo = 400;
  if (error?.code === 'LIMIT_FILE_SIZE') codigo = 413;
  // Origen fuera de la lista blanca: es una negacion de permiso, no un request
  // mal formado.
  else if (mensaje.startsWith('Origen no permitido')) codigo = 403;
  res.status(codigo).type('text/plain').send(mensaje);
});

async function main() {
  try {
    await cargarOrdenDemo();
    console.log(
      `orden de compra de referencia: ${ordenDemo.orden_id} (${ordenDemo.proveedor.nombre}), ` +
        `${ordenDemo.items.length} items, total ${ordenDemo.totales.total} ${ordenDemo.moneda}`
    );
  } catch (error) {
    console.error(`No se pudo cargar la orden de demo desde ${RUTA_ORDEN}: ${error?.message}`);
    process.exit(1);
  }

  if (process.env.PRECARGAR === '1') {
    console.log('precargando modelos (PRECARGAR=1)...');
    try {
      if (!SECUENCIAL) await cargarModeloOcr();
      await cargarModeloEstructurador();
      console.log('modelos listos.');
    } catch (error) {
      console.error(`fallo la precarga: ${error?.message}. Se intentara en el primer request.`);
    }
  }

  const server = app.listen(PUERTO, '127.0.0.1', () => {
    console.log(`InvoiceGuard API en http://127.0.0.1:${PUERTO}`);
    console.log(`  POST /reconcile   (campo "factura")`);
    console.log(`  GET  /health`);
    console.log(`  CORS: ${ORIGENES.join(', ')}`);
    console.log(
      `  modo: ${SECUENCIAL ? 'secuencial' : 'modelos concurrentes'}` +
        `${USAR_CACHE_OCR ? ', cache de OCR activa' : ''}`
    );
  });

  // La inferencia local tarda ~85 s por factura y el primer request puede
  // sumar la carga de modelos. Sin limite de tiempo del lado del server: el
  // que corta es el usuario, no un timeout arbitrario.
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.keepAliveTimeout = 120000;
  server.setTimeout(0);

  const apagar = async () => {
    console.log('\ncerrando...');
    server.close();
    try {
      await liberarModeloOcr();
    } catch {}
    try {
      const { close } = await import('@qvac/sdk');
      await close();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
}

main();
