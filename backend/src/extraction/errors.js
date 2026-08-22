/**
 * Errores tipados del Modulo A (extraccion).
 *
 * El servidor HTTP los mapea a status codes: todo ErrorExtraccion es 422
 * (no se pudo leer el documento), y ErrorModelo tambien, con detalle distinto.
 * Nunca devolvemos 200 con datos vacios.
 */

export class ErrorExtraccion extends Error {
  /**
   * @param {string} message
   * @param {object} [detalle]
   */
  constructor(message, detalle = {}) {
    super(message);
    this.name = 'ErrorExtraccion';
    this.codigo = detalle.codigo ?? 'EXTRACCION_FALLIDA';
    this.detalle = detalle;
  }
}

export class ErrorFormatoNoSoportado extends ErrorExtraccion {
  /**
   * @param {string} message
   * @param {object} [detalle]
   */
  constructor(message, detalle = {}) {
    super(message, { ...detalle, codigo: detalle.codigo ?? 'FORMATO_NO_SOPORTADO' });
    this.name = 'ErrorFormatoNoSoportado';
  }
}

export class ErrorModelo extends ErrorExtraccion {
  /**
   * @param {string} message
   * @param {object} [detalle]
   */
  constructor(message, detalle = {}) {
    super(message, { ...detalle, codigo: detalle.codigo ?? 'MODELO_NO_DISPONIBLE' });
    this.name = 'ErrorModelo';
  }
}
