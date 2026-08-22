/**
 * Aritmetica monetaria en centavos enteros.
 *
 * Regla: ninguna comparacion de dinero se hace con floats. Todo se convierte
 * a centavos enteros y se compara ahi. Evita que 0.1 + 0.2 !== 0.3 genere
 * discrepancias fantasma.
 */

/** Escala usada para cantidades (permite fracciones tipo 2.5 kg). */
const ESCALA_CANTIDAD = 1000;

/**
 * Parsea un monto que puede venir como number o como string de OCR.
 *
 * Soporta: "1.234,56" (es), "1,234.56" (en), "1234.56", "$ 1.234,56",
 * "USD 1234", "(1234.56)" (negativo contable), "-1234,56".
 *
 * Heuristica del separador decimal:
 *  - Si aparecen coma y punto, el ultimo en aparecer es el decimal.
 *  - Si aparece uno solo y esta repetido, es separador de miles.
 *  - Si aparece uno solo y el grupo final tiene exactamente 3 digitos, se
 *    asume miles (convencion "1.234" = 1234), salvo que la parte entera sea "0".
 *  - En cualquier otro caso es decimal.
 *
 * @param {unknown} entrada
 * @returns {number|null} null si no se puede interpretar
 */
export function parsearMonto(entrada) {
  if (entrada === null || entrada === undefined) return null;
  if (typeof entrada === 'number') return Number.isFinite(entrada) ? entrada : null;
  if (typeof entrada !== 'string') return null;

  let s = entrada.trim();
  if (!s) return null;

  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (/-/.test(s)) negativo = true;

  // Fuera simbolos de moneda, letras, espacios duros y signos.
  s = s.replace(/[^0-9.,]/g, '');
  if (!s) return null;

  const sep = detectarSeparadorDecimal(s);
  if (sep === ',') {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (sep === '.') {
    s = s.replace(/,/g, '');
  } else {
    s = s.replace(/[.,]/g, '');
  }

  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/**
 * @param {string} s solo digitos, comas y puntos
 * @returns {','|'.'|null} null = ambos son separadores de miles
 */
function detectarSeparadorDecimal(s) {
  const ultimaComa = s.lastIndexOf(',');
  const ultimoPunto = s.lastIndexOf('.');
  if (ultimaComa < 0 && ultimoPunto < 0) return null;
  if (ultimaComa >= 0 && ultimoPunto >= 0) return ultimaComa > ultimoPunto ? ',' : '.';

  const sep = ultimaComa >= 0 ? ',' : '.';
  const partes = s.split(sep);
  if (partes.length > 2) return null; // 1.234.567 -> miles
  const [entera, decimal] = partes;
  if (decimal.length === 3) {
    // Ambiguo: "1.234" -> miles; "0.500" -> decimal.
    return entera === '0' || entera === '' ? sep : null;
  }
  return sep;
}

/**
 * Convierte un monto (number o string) a centavos enteros.
 * @param {unknown} valor
 * @returns {number|null}
 */
export function aCentavos(valor) {
  const n = parsearMonto(valor);
  if (n === null) return null;
  // toFixed intermedio para matar el ruido binario de 1234.565 * 100.
  return Math.round(Number((n * 100).toFixed(6)));
}

/**
 * @param {number|null} centavos
 * @returns {number|null}
 */
export function aMonto(centavos) {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) return null;
  return Number((centavos / 100).toFixed(2));
}

/**
 * Convierte una cantidad a milesimas enteras.
 * @param {unknown} valor
 * @returns {number|null}
 */
export function aMilesimas(valor) {
  const n = parsearMonto(valor);
  if (n === null) return null;
  return Math.round(Number((n * ESCALA_CANTIDAD).toFixed(6)));
}

/**
 * @param {number|null} milesimas
 * @returns {number|null}
 */
export function aCantidad(milesimas) {
  if (milesimas === null || milesimas === undefined || !Number.isFinite(milesimas)) return null;
  return Number((milesimas / ESCALA_CANTIDAD).toFixed(3));
}

/**
 * Compara dos valores en centavos aplicando tolerancia.
 * @param {number} facturaCents
 * @param {number} ordenCents
 * @param {{ centavos?: number, relativa?: number }} tolerancia
 * @returns {{ coincide: boolean, delta: number, deltaRelativo: number, toleranciaAplicada: number }}
 */
export function compararCentavos(facturaCents, ordenCents, tolerancia = {}) {
  const abs = Number.isFinite(tolerancia.centavos) ? tolerancia.centavos : 0;
  const rel = Number.isFinite(tolerancia.relativa) ? tolerancia.relativa : 0;
  const delta = facturaCents - ordenCents;
  const base = Math.abs(ordenCents);
  const toleranciaAplicada = Math.max(abs, Math.round(rel * base));
  return {
    coincide: Math.abs(delta) <= toleranciaAplicada,
    delta,
    deltaRelativo: base === 0 ? (delta === 0 ? 0 : 1) : Math.abs(delta) / base,
    toleranciaAplicada
  };
}

/**
 * Formatea centavos como texto legible para humanos.
 * @param {number|null} centavos
 * @param {string} [moneda]
 * @returns {string}
 */
export function formatearMonto(centavos, moneda = '') {
  if (centavos === null || centavos === undefined || !Number.isFinite(centavos)) return 's/d';
  const negativo = centavos < 0;
  const absoluto = Math.abs(centavos);
  const entera = Math.trunc(absoluto / 100).toString();
  const dec = String(absoluto % 100).padStart(2, '0');
  const conMiles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const texto = `${negativo ? '-' : ''}${conMiles},${dec}`;
  return moneda ? `${texto} ${moneda}` : texto;
}

/**
 * Formatea una cantidad en milesimas, sin ceros decimales inutiles.
 * @param {number|null} milesimas
 * @returns {string}
 */
export function formatearCantidad(milesimas) {
  if (milesimas === null || milesimas === undefined || !Number.isFinite(milesimas)) return 's/d';
  const n = milesimas / ESCALA_CANTIDAD;
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/** Pares de digitos que el OCR confunde habitualmente. */
const CONFUSIONES_OCR = [
  ['0', '8'], ['0', '6'], ['0', '9'], ['1', '7'], ['1', '4'], ['3', '8'],
  ['3', '9'], ['5', '6'], ['5', '8'], ['6', '8'], ['9', '8'], ['2', '7']
];

/**
 * Intenta explicar una diferencia numerica como error tipico de OCR.
 * 100% determinisitico: no hay IA aca, son patrones de digitos.
 *
 * @param {number} facturaCents
 * @param {number} ordenCents
 * @returns {string|null} explicacion o null si no matchea ningun patron
 */
export function detectarPatronOcr(facturaCents, ordenCents) {
  if (facturaCents === ordenCents) return null;
  const a = String(Math.abs(facturaCents));
  const b = String(Math.abs(ordenCents));

  // Corrimiento del separador decimal / factor 10.
  for (const factor of [10, 100, 1000]) {
    if (facturaCents === ordenCents * factor) {
      return `el valor de la factura es ${factor}x el ordenado: posible corrimiento del separador decimal en el OCR`;
    }
    if (ordenCents === facturaCents * factor) {
      return `el valor de la factura es 1/${factor} del ordenado: posible corrimiento del separador decimal en el OCR`;
    }
  }

  if (a.length === b.length) {
    // Transposicion: mismos digitos en otro orden.
    const ordenar = (t) => t.split('').sort().join('');
    if (a !== b && ordenar(a) === ordenar(b)) {
      const posiciones = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) posiciones.push(i + 1);
      return `mismos digitos en orden distinto (posiciones ${posiciones.join(' y ')}): posible transposicion al leer el documento`;
    }
    // Sustitucion de un solo digito confundible.
    const distintos = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) distintos.push(i);
    if (distintos.length === 1) {
      const i = distintos[0];
      const par = CONFUSIONES_OCR.find(
        ([x, y]) => (a[i] === x && b[i] === y) || (a[i] === y && b[i] === x)
      );
      if (par) {
        return `difiere en un unico digito (${b[i]} leido como ${a[i]}), confusion frecuente de OCR`;
      }
      return `difiere en un unico digito (${b[i]} leido como ${a[i]})`;
    }
  }

  // Digito extra o faltante.
  if (Math.abs(a.length - b.length) === 1) {
    const largo = a.length > b.length ? a : b;
    const corto = a.length > b.length ? b : a;
    for (let i = 0; i < largo.length; i++) {
      if (largo.slice(0, i) + largo.slice(i + 1) === corto) {
        return `se agrego o perdio un digito respecto del valor esperado: posible error de lectura`;
      }
    }
  }

  return null;
}
