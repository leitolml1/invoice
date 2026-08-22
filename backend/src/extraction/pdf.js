/**
 * Rasterizado de PDF a PNG. 100% local (mupdf.js corre sobre WASM, sin red).
 *
 * Por que existe: el OCR de QVAC solo recibe imagenes (ver FORMATOS_SOPORTADOS
 * en extract.js). Muchas facturas reales llegan como PDF, asi que en vez de
 * rechazarlas convertimos la primera pagina a PNG antes de pasarla al pipeline
 * de siempre. El resto de extract.js no se entera de que el origen fue un PDF.
 */

import mupdf from 'mupdf';

/** Escala de renderizado. 2x alcanza resolucion comoda para el OCR sin inflar demasiado el buffer. */
const ESCALA_RENDER = 2;

/**
 * Rasteriza la primera pagina de un PDF a PNG.
 *
 * @param {Buffer} buffer contenido del PDF
 * @returns {Buffer} PNG de la primera pagina
 */
export function rasterizarPrimeraPaginaPdf(buffer) {
  const documento = mupdf.Document.openDocument(buffer, 'application/pdf');
  if (documento.countPages() < 1) {
    throw new Error('El PDF no tiene paginas.');
  }
  const pagina = documento.loadPage(0);
  const matriz = mupdf.Matrix.scale(ESCALA_RENDER, ESCALA_RENDER);
  const pixmap = pagina.toPixmap(matriz, mupdf.ColorSpace.DeviceRGB, false);
  return Buffer.from(pixmap.asPNG());
}
