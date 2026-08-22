/**
 * MODULO A - extraccion de facturas. OCR + estructuracion, 100% local via @qvac/sdk.
 *
 * Pipeline:
 *   archivo -> validacion de formato
 *           -> ocr()            (QVAC, ggml-ocr)      -> bloques con bbox + confianza
 *           -> layout           (determinisitico)      -> filas reconstruidas
 *           -> completion()     (QVAC, LLM 1-4B Q4)   -> JSON estructurado
 *           -> verificacion     (determinisitico)      -> confianza real + needs_review
 *
 * De donde sale `confianza`: de la confianza que reporta el OCR para el bloque
 * de texto que respalda el valor. NO la inventa el LLM. Si un valor que devolvio
 * el LLM no aparece en ningun bloque del OCR, se marca needs_review y se le
 * asigna confianza baja: es la guarda anti-alucinacion.
 *
 * LIMITACION CONOCIDA (medida, no teorica): si el OCR lee mal con alta confianza
 * (visto en esta maquina: "18/07/2026" leido como "8/07/2026" con confianza
 * 1.00), este modulo no lo puede detectar, porque su unica fuente de verdad es
 * el propio OCR. Esa clase de error la caza el Modulo B al comparar contra la
 * orden de compra.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ErrorExtraccion, ErrorFormatoNoSoportado } from './errors.js';
import { ejecutarOcr } from './ocrEngine.js';
import { estructurar } from './structurer.js';
import { aCeldas, agruparEnFilas, confianzaDeValor, estimarInclinacion } from './layout.js';
import { reconstruirTabla, construirEntradaLlm } from './table.js';

export const VERSION_EXTRACCION = '1.0.0';

/** Debajo de esto, el campo se marca para revision humana. */
export const UMBRAL_CONFIANZA_POR_DEFECTO = 0.75;

/**
 * Detecta el formato por magic bytes, no por extension.
 * @param {Buffer} buffer
 * @returns {string}
 */
export function detectarFormato(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  if (buffer.length >= 4 && (buffer.subarray(0, 4).toString('latin1') === 'II*\u0000' || buffer.subarray(0, 4).toString('latin1') === 'MM\u0000*')) {
    return 'tiff';
  }
  return 'desconocido';
}

/** Formatos que el OCR de QVAC acepta directamente como imagen. */
const FORMATOS_SOPORTADOS = new Set(['png', 'jpeg', 'bmp']);

/**
 * Construye un campo envuelto { valor, confianza, needs_review } respaldado por el OCR.
 *
 * @param {unknown} valor valor que devolvio el LLM
 * @param {import('./layout.js').Celda[]} celdas
 * @param {object} ctx
 * @param {string} ctx.campo nombre/ruta del campo
 * @param {Set<string>} ctx.inseguros campos que el propio modelo declaro inseguros
 * @param {number} ctx.umbral
 * @param {string[]} ctx.advertencias
 * @returns {{ valor: unknown, confianza: number, needs_review: boolean, texto_crudo: string|null, verificado_en_ocr: boolean }}
 */
function construirCampo(valor, celdas, ctx) {
  const vacio =
    valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');

  if (vacio) {
    return {
      valor: null,
      confianza: 0,
      needs_review: true,
      texto_crudo: null,
      verificado_en_ocr: false
    };
  }

  const hallazgo = confianzaDeValor(celdas, valor);

  if (!hallazgo) {
    ctx.advertencias.push(
      `${ctx.campo}: el valor ${JSON.stringify(valor)} no aparece en ningun bloque leido por el ` +
        'OCR; podria ser una invencion del modelo. Marcado para revision.'
    );
    return {
      valor,
      confianza: 0.2,
      needs_review: true,
      texto_crudo: null,
      verificado_en_ocr: false
    };
  }

  const declaradoInseguro = ctx.inseguros.has(ctx.campo);
  return {
    valor,
    confianza: Number(hallazgo.confianza.toFixed(3)),
    needs_review: declaradoInseguro || hallazgo.confianza < ctx.umbral,
    texto_crudo: hallazgo.texto_fuente,
    verificado_en_ocr: true
  };
}

/**
 * @param {unknown} v
 * @returns {number|null}
 */
function aNumeroONull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/[^0-9.,-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Extrae una factura desde un archivo de imagen.
 *
 * @param {string|Buffer} entrada ruta al archivo, o buffer con su contenido
 * @param {object} [opciones]
 * @param {string} [opciones.nombreArchivo] nombre original (para trazabilidad)
 * @param {string} [opciones.documentoId]
 * @param {number} [opciones.umbralConfianza]
 * @param {object} [opciones.ocr] overrides de modelConfig del OCR
 * @param {import('./layout.js').BloqueOcr[]} [opciones.bloquesOcr] bloques ya
 *   obtenidos; si vienen, no se carga ni se ejecuta el motor de OCR
 * @param {object} [opciones.llm] overrides del estructurador ({ modelo, ctx_size, intentos })
 * @returns {Promise<object>} factura con campos envueltos, lista para parsearFacturaExtraida()
 */
export async function extraerFactura(entrada, opciones = {}) {
  const inicioTotal = Date.now();
  const umbral = opciones.umbralConfianza ?? UMBRAL_CONFIANZA_POR_DEFECTO;
  const advertencias = [];

  // --- 1) Cargar y validar el archivo ---
  let buffer;
  let nombreArchivo = opciones.nombreArchivo ?? null;
  if (typeof entrada === 'string') {
    nombreArchivo = nombreArchivo ?? path.basename(entrada);
    try {
      buffer = await readFile(entrada);
    } catch (error) {
      throw new ErrorExtraccion(`No se pudo leer el archivo "${entrada}": ${error?.message}`, {
        codigo: 'ARCHIVO_ILEGIBLE'
      });
    }
  } else if (Buffer.isBuffer(entrada)) {
    buffer = entrada;
  } else {
    throw new ErrorExtraccion('extraerFactura espera una ruta (string) o un Buffer.', {
      codigo: 'ENTRADA_INVALIDA'
    });
  }

  if (!buffer.length) {
    throw new ErrorExtraccion('El archivo esta vacio.', { codigo: 'ARCHIVO_VACIO' });
  }

  const formato = detectarFormato(buffer);
  if (formato === 'pdf') {
    throw new ErrorFormatoNoSoportado(
      'El OCR de QVAC recibe imagenes, no PDF. Este backend no incluye rasterizado de PDF, ' +
        'asi que hay que convertir la pagina a PNG/JPG antes de subirla.',
      { formato, codigo: 'PDF_NO_SOPORTADO' }
    );
  }
  if (!FORMATOS_SOPORTADOS.has(formato)) {
    throw new ErrorFormatoNoSoportado(
      `Formato de archivo no soportado (detectado: ${formato}). Se aceptan PNG, JPEG y BMP.`,
      { formato }
    );
  }

  // --- 2) OCR ---
  // `bloquesOcr` permite inyectar bloques ya obtenidos y saltear el motor. Se
  // usa para probar el resto del pipeline sin cargar el modelo de OCR, que en
  // maquinas con poca RAM no puede convivir con el del LLM.
  const resultadoOcr = opciones.bloquesOcr
    ? { bloques: opciones.bloquesOcr, stats: null, duracion_ms: 0, modelId: 'inyectado' }
    : await ejecutarOcr(buffer, { modelConfig: opciones.ocr });
  const celdas = aCeldas(resultadoOcr.bloques);
  if (!celdas.length) {
    throw new ErrorExtraccion(
      'El OCR no encontro ningun texto en la imagen. Puede estar en blanco, muy borrosa o ' +
        'con resolucion insuficiente.',
      { codigo: 'SIN_TEXTO' }
    );
  }

  // --- 3) Layout determinisitico: filas, inclinacion y bandas de columna ---
  //
  // Son dos pasadas a proposito. Para corregir la inclinacion del escaneo hace
  // falta una linea de referencia que se sepa horizontal, y la mejor candidata
  // es el encabezado de la tabla; pero para encontrar el encabezado hay que
  // haber agrupado filas antes. Asi que se agrupa de forma tosca, se ubica el
  // encabezado, se mide la pendiente sobre sus celdas y se reagrupa corregido.
  const filasCrudas = agruparEnFilas(celdas);
  const tablaCruda = reconstruirTabla(filasCrudas);

  let pendiente = 0;
  if (tablaCruda.encabezado) {
    const celdasEncabezado = filasCrudas[tablaCruda.encabezado.indice].celdas.filter((c) =>
      tablaCruda.encabezado.columnas.some((col) => col.x1 === c.x1 && col.x2 === c.x2)
    );
    pendiente = estimarInclinacion(celdasEncabezado);
  }

  const filas = pendiente !== 0 ? agruparEnFilas(celdas, { pendiente }) : filasCrudas;
  const tabla = pendiente !== 0 ? reconstruirTabla(filas) : tablaCruda;

  if (!tabla.encabezado) {
    advertencias.push(
      'No se encontro la fila de encabezados de la tabla de items, asi que las columnas no se ' +
        'pudieron resolver por posicion. Los items quedan a criterio del modelo y son menos confiables.'
    );
  }

  const textoDocumento = construirEntradaLlm(filas, tabla);

  // --- 4) Estructuracion con LLM local ---
  const resultadoLlm = await estructurar(textoDocumento, opciones.llm ?? {});
  const datos = resultadoLlm.datos ?? {};

  const inseguros = new Set(
    Array.isArray(datos.campos_inseguros) ? datos.campos_inseguros.map(String) : []
  );
  const ctxBase = { inseguros, umbral, advertencias };

  // --- 5) Armado de campos envueltos con confianza real ---
  const proveedorNombre = construirCampo(datos.proveedor ?? null, celdas, {
    ...ctxBase,
    campo: 'proveedor'
  });
  const idFiscal = construirCampo(datos.identificacion_fiscal ?? null, celdas, {
    ...ctxBase,
    campo: 'identificacion_fiscal'
  });
  const numeroFactura = construirCampo(datos.numero_factura ?? null, celdas, {
    ...ctxBase,
    campo: 'numero_factura'
  });
  const fecha = construirCampo(datos.fecha ?? null, celdas, { ...ctxBase, campo: 'fecha' });
  const moneda = construirCampo(datos.moneda ?? null, celdas, { ...ctxBase, campo: 'moneda' });
  const ocReferencia = construirCampo(datos.orden_compra_referencia ?? null, celdas, {
    ...ctxBase,
    campo: 'orden_compra_referencia'
  });

  const itemsCrudos = Array.isArray(datos.items) ? datos.items : [];
  if (!itemsCrudos.length) {
    advertencias.push('El modelo no devolvio ningun item de la factura.');
  }

  const items = itemsCrudos.map((item, indice) => {
    const it = item && typeof item === 'object' ? item : {};
    const prefijo = `items[${indice}]`;
    const cantidad = aNumeroONull(it.cantidad);
    const precio = aNumeroONull(it.precio_unitario);
    const total = aNumeroONull(it.total);

    const campoCantidad = construirCampo(cantidad, celdas, {
      ...ctxBase,
      campo: `${prefijo}.cantidad`
    });
    const campoPrecio = construirCampo(precio, celdas, {
      ...ctxBase,
      campo: `${prefijo}.precio_unitario`
    });
    const campoTotal = construirCampo(total, celdas, { ...ctxBase, campo: `${prefijo}.total` });

    // Chequeo aritmetico determinisitico: si cantidad x precio no da el importe,
    // alguno de los tres esta mal leido. Marcamos los tres para revision.
    if (cantidad !== null && precio !== null && total !== null) {
      const esperado = Math.round(cantidad * precio * 100);
      const declarado = Math.round(total * 100);
      if (Math.abs(esperado - declarado) > 2) {
        advertencias.push(
          `${prefijo}: ${cantidad} x ${precio} = ${(esperado / 100).toFixed(2)} pero el importe ` +
            `leido es ${(declarado / 100).toFixed(2)}. Algun valor de la linea esta mal leido.`
        );
        campoCantidad.needs_review = true;
        campoPrecio.needs_review = true;
        campoTotal.needs_review = true;
      }
    }

    return {
      linea: indice + 1,
      codigo: construirCampo(it.codigo ?? null, celdas, { ...ctxBase, campo: `${prefijo}.codigo` }),
      nombre: construirCampo(it.nombre ?? null, celdas, { ...ctxBase, campo: `${prefijo}.nombre` }),
      cantidad: campoCantidad,
      unidad: construirCampo(it.unidad ?? null, celdas, { ...ctxBase, campo: `${prefijo}.unidad` }),
      precio_unitario: campoPrecio,
      total: campoTotal
    };
  });

  const subtotal = construirCampo(aNumeroONull(datos.subtotal), celdas, {
    ...ctxBase,
    campo: 'subtotal'
  });
  const impuestos = construirCampo(aNumeroONull(datos.impuestos), celdas, {
    ...ctxBase,
    campo: 'impuestos'
  });
  const totalFactura = construirCampo(aNumeroONull(datos.total_factura), celdas, {
    ...ctxBase,
    campo: 'total_factura'
  });

  // --- 6) Agregados ---
  const todos = [
    proveedorNombre, idFiscal, numeroFactura, fecha, moneda, ocReferencia,
    subtotal, impuestos, totalFactura,
    ...items.flatMap((i) => [i.codigo, i.nombre, i.cantidad, i.unidad, i.precio_unitario, i.total])
  ];
  const criticos = [
    proveedorNombre, fecha, totalFactura,
    ...items.flatMap((i) => [i.nombre, i.cantidad, i.precio_unitario, i.total])
  ];
  const presentes = todos.filter((c) => c.valor !== null);
  const confianzaGlobal = presentes.length
    ? Number((presentes.reduce((a, c) => a + c.confianza, 0) / presentes.length).toFixed(4))
    : 0;

  return {
    schema_version: VERSION_EXTRACCION,
    documento_id:
      opciones.documentoId ??
      (numeroFactura.valor ? String(numeroFactura.valor) : nombreArchivo ?? 'factura-sin-id'),
    tipo_documento: 'factura',
    origen: {
      archivo: nombreArchivo,
      formato,
      bytes: buffer.length,
      motor: 'qvac',
      modelo_ocr: 'OCR_LATIN (ggml-ocr)',
      modelo_estructurador: opciones.llm?.modelo ?? 'qwen3-1.7b-q4',
      local: true
    },
    proveedor: { nombre: proveedorNombre, identificacion_fiscal: idFiscal },
    numero_factura: numeroFactura,
    fecha,
    moneda,
    orden_compra_referencia: ocReferencia,
    items,
    totales: { subtotal, impuestos, total_factura: totalFactura },
    needs_review: criticos.some((c) => c.needs_review),
    confianza_global: confianzaGlobal,
    extraccion: {
      ocr: {
        bloques: celdas.length,
        filas: filas.length,
        duracion_ms: resultadoOcr.duracion_ms,
        stats: resultadoOcr.stats ?? null
      },
      tabla: {
        inclinacion_estimada: Number(pendiente.toFixed(5)),
        encabezado_detectado: Boolean(tabla.encabezado),
        columnas: tabla.encabezado?.columnas.map((c) => c.rol) ?? [],
        filas_items: tabla.items.length
      },
      llm: {
        duracion_ms: resultadoLlm.duracion_ms,
        intentos_usados: resultadoLlm.intentos_usados,
        tokens_por_segundo: resultadoLlm.stats?.tokensPerSecond ?? null,
        backend: resultadoLlm.stats?.backendDevice ?? null
      },
      campos_inseguros_declarados: [...inseguros],
      advertencias,
      duracion_total_ms: Date.now() - inicioTotal,
      texto_ocr: textoDocumento
    }
  };
}
