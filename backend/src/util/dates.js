/**
 * Parseo y comparacion de fechas sin dependencias.
 *
 * Trabajamos siempre con fechas "civiles" (sin hora, sin zona) representadas
 * como string ISO 'YYYY-MM-DD'. Usar Date con zonas horarias para fechas de
 * factura es una fuente clasica de bugs de +-1 dia.
 */

const MESES = new Map(Object.entries({
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12
}));

/**
 * @param {number} anio
 * @param {number} mes 1-12
 * @param {number} dia 1-31
 * @returns {boolean}
 */
function esFechaValida(anio, mes, dia) {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || !Number.isInteger(dia)) return false;
  if (anio < 1900 || anio > 2999 || mes < 1 || mes > 12 || dia < 1) return false;
  const diasEnMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return dia <= diasEnMes;
}

/**
 * @param {number} anio
 * @param {number} mes
 * @param {number} dia
 * @returns {string} 'YYYY-MM-DD'
 */
function aIso(anio, mes, dia) {
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Normaliza un anio de 2 digitos: 00-69 -> 2000s, 70-99 -> 1900s.
 * @param {number} n
 * @returns {number}
 */
function expandirAnio(n) {
  if (n >= 100) return n;
  return n <= 69 ? 2000 + n : 1900 + n;
}

/**
 * @typedef {object} FechaParseada
 * @property {string} iso 'YYYY-MM-DD'
 * @property {boolean} ambigua true si dia y mes son ambos <= 12 y el formato era numerico
 * @property {string} formato etiqueta del patron reconocido
 * @property {string|null} iso_alternativo interpretacion alternativa si es ambigua
 */

/**
 * Parsea una fecha desde varios formatos habituales de facturas.
 *
 * @param {unknown} entrada
 * @param {{ preferir?: 'dmy'|'mdy' }} [opciones]
 * @returns {FechaParseada|null}
 */
export function parsearFecha(entrada, opciones = {}) {
  const preferir = opciones.preferir === 'mdy' ? 'mdy' : 'dmy';

  if (entrada instanceof Date) {
    if (Number.isNaN(entrada.getTime())) return null;
    return {
      iso: aIso(entrada.getUTCFullYear(), entrada.getUTCMonth() + 1, entrada.getUTCDate()),
      ambigua: false,
      formato: 'date',
      iso_alternativo: null
    };
  }
  if (entrada === null || entrada === undefined) return null;

  const s = String(entrada).trim();
  if (!s) return null;

  // 1) ISO / anio primero: 2026-07-15, 2026/07/15, 2026.07.15
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) {
    const [, a, b, c] = m.map(Number);
    if (esFechaValida(a, b, c)) {
      return { iso: aIso(a, b, c), ambigua: false, formato: 'iso', iso_alternativo: null };
    }
    return null;
  }

  // 2) Compacto: 20260715
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const [, a, b, c] = m.map(Number);
    if (esFechaValida(a, b, c)) {
      return { iso: aIso(a, b, c), ambigua: false, formato: 'compacto', iso_alternativo: null };
    }
    return null;
  }

  // 3) Numerico con anio al final: 15/07/2026, 15-07-26, 7.15.2026
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const p1 = Number(m[1]);
    const p2 = Number(m[2]);
    const anio = expandirAnio(Number(m[3]));

    const dmyValida = esFechaValida(anio, p2, p1);
    const mdyValida = esFechaValida(anio, p1, p2);

    if (dmyValida && mdyValida) {
      const principal = preferir === 'dmy' ? aIso(anio, p2, p1) : aIso(anio, p1, p2);
      const alternativo = preferir === 'dmy' ? aIso(anio, p1, p2) : aIso(anio, p2, p1);
      return {
        iso: principal,
        ambigua: principal !== alternativo,
        formato: `numerico_${preferir}`,
        iso_alternativo: principal !== alternativo ? alternativo : null
      };
    }
    if (dmyValida) return { iso: aIso(anio, p2, p1), ambigua: false, formato: 'numerico_dmy', iso_alternativo: null };
    if (mdyValida) return { iso: aIso(anio, p1, p2), ambigua: false, formato: 'numerico_mdy', iso_alternativo: null };
    return null;
  }

  // 4) Con nombre de mes: "15 de julio de 2026", "15 jul 2026", "Jul 15, 2026"
  const limpio = s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\bde\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  m = limpio.match(/^(\d{1,2}) ([a-z]+) (\d{2,4})$/);
  if (m && MESES.has(m[2])) {
    const dia = Number(m[1]);
    const mes = MESES.get(m[2]);
    const anio = expandirAnio(Number(m[3]));
    if (esFechaValida(anio, mes, dia)) {
      return { iso: aIso(anio, mes, dia), ambigua: false, formato: 'mes_texto', iso_alternativo: null };
    }
    return null;
  }

  m = limpio.match(/^([a-z]+) (\d{1,2}) (\d{2,4})$/);
  if (m && MESES.has(m[1])) {
    const mes = MESES.get(m[1]);
    const dia = Number(m[2]);
    const anio = expandirAnio(Number(m[3]));
    if (esFechaValida(anio, mes, dia)) {
      return { iso: aIso(anio, mes, dia), ambigua: false, formato: 'mes_texto', iso_alternativo: null };
    }
    return null;
  }

  return null;
}

/**
 * Diferencia en dias entre dos fechas ISO (a - b).
 * @param {string} isoA
 * @param {string} isoB
 * @returns {number|null}
 */
export function diferenciaDias(isoA, isoB) {
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/**
 * Suma dias a una fecha ISO.
 * @param {string} iso
 * @param {number} dias
 * @returns {string|null}
 */
export function sumarDias(iso, dias) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + dias * 86400000);
  return aIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Formatea una fecha ISO como dd/mm/yyyy para texto legible.
 * @param {string|null} iso
 * @returns {string}
 */
export function formatearFecha(iso) {
  if (!iso || typeof iso !== 'string') return 's/d';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso);
  return `${m[3]}/${m[2]}/${m[1]}`;
}
