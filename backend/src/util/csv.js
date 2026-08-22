/**
 * Parser CSV sin dependencias, tolerante a lo que sale de Excel/Sheets.
 *
 * Soporta: comillas dobles, comillas escapadas (""), delimitadores dentro de
 * comillas, saltos de linea dentro de comillas, CRLF/LF, BOM UTF-8 y
 * autodeteccion de delimitador (coma / punto y coma / tab / pipe).
 */

const DELIMITADORES = [',', ';', '\t', '|'];

/**
 * Detecta el delimitador contando ocurrencias fuera de comillas en la 1ra linea.
 * @param {string} texto
 * @returns {string}
 */
export function detectarDelimitador(texto) {
  const primeraLinea = texto.split(/\r?\n/, 1)[0] ?? '';
  let mejor = ',';
  let maximo = -1;
  for (const d of DELIMITADORES) {
    let cuenta = 0;
    let enComillas = false;
    for (let i = 0; i < primeraLinea.length; i++) {
      const c = primeraLinea[i];
      if (c === '"') {
        enComillas = !enComillas;
      } else if (c === d && !enComillas) {
        cuenta++;
      }
    }
    if (cuenta > maximo) {
      maximo = cuenta;
      mejor = d;
    }
  }
  return mejor;
}

/**
 * Parsea CSV a matriz de strings.
 * @param {string} texto
 * @param {{ delimitador?: string }} [opciones]
 * @returns {string[][]}
 */
export function parsearCsvMatriz(texto, opciones = {}) {
  if (typeof texto !== 'string') throw new TypeError('parsearCsvMatriz espera un string');
  let contenido = texto.replace(/^\uFEFF/, '');
  const d = opciones.delimitador ?? detectarDelimitador(contenido);

  /** @type {string[][]} */
  const filas = [];
  /** @type {string[]} */
  let fila = [];
  let campo = '';
  let enComillas = false;
  let i = 0;

  const cerrarCampo = () => {
    fila.push(campo);
    campo = '';
  };
  const cerrarFila = () => {
    cerrarCampo();
    filas.push(fila);
    fila = [];
  };

  while (i < contenido.length) {
    const c = contenido[i];

    if (enComillas) {
      if (c === '"') {
        if (contenido[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        enComillas = false;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }

    if (c === '"' && campo.trim() === '') {
      campo = '';
      enComillas = true;
      i++;
      continue;
    }
    if (c === d) {
      cerrarCampo();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      cerrarFila();
      i++;
      continue;
    }
    campo += c;
    i++;
  }

  // Ultima fila si el archivo no termina en salto de linea.
  if (campo !== '' || fila.length > 0) cerrarFila();

  // Descarta filas totalmente vacias.
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

/**
 * Parsea CSV con encabezado a array de objetos.
 * Las claves se normalizan a snake_case minuscula.
 *
 * @param {string} texto
 * @param {{ delimitador?: string }} [opciones]
 * @returns {Record<string, string>[]}
 */
export function parsearCsv(texto, opciones = {}) {
  const matriz = parsearCsvMatriz(texto, opciones);
  if (!matriz.length) return [];

  const encabezado = matriz[0].map((h) =>
    h
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );

  return matriz.slice(1).map((fila) => {
    /** @type {Record<string, string>} */
    const objeto = {};
    for (let j = 0; j < encabezado.length; j++) {
      if (!encabezado[j]) continue;
      objeto[encabezado[j]] = (fila[j] ?? '').trim();
    }
    return objeto;
  });
}
