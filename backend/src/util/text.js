/**
 * Normalizacion y similitud de texto, 100% determinisitico.
 *
 * Esta es la pieza que evita depender de IA para el 90% de los casos de
 * "el proveedor se escribe distinto". La IA (Capa 2) solo entra cuando estas
 * metricas caen en la zona gris configurada.
 */

/** Sufijos societarios que no aportan identidad al nombre. */
const SUFIJOS_SOCIETARIOS = new Set([
  'sa', 'saic', 'sacif', 'sac', 'sas', 'srl', 'sl', 'slu', 'spa', 'sca', 'scs',
  'ltda', 'ltd', 'limited', 'inc', 'incorporated', 'llc', 'lp', 'llp', 'plc',
  'corp', 'corporation', 'co', 'company', 'gmbh', 'ag', 'bv', 'nv', 'oy', 'ab',
  'cia', 'compania', 'eirl', 'unipersonal', 'sociedad', 'anonima', 'holding',
  'group', 'grupo', 'international', 'internacional'
]);

/** Palabras funcionales que inflan la similitud sin aportar identidad. */
const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'and', 'the', 'of', 'da',
  'do', 'para', 'por', 'con', 'en', 'a', 'al'
]);

/**
 * Quita diacriticos.
 * @param {string} s
 * @returns {string}
 */
export function quitarAcentos(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalizacion base: minusculas, sin acentos, sin puntuacion, espacios simples.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizarTexto(s) {
  if (s === null || s === undefined) return '';
  return quitarAcentos(String(s))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Normaliza un nombre de empresa: base + sin sufijos societarios ni palabras vacias.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizarNombreEmpresa(s) {
  const base = normalizarTexto(s);
  if (!base) return '';
  const tokens = base
    .split(' ')
    .filter((t) => t && !SUFIJOS_SOCIETARIOS.has(t) && !PALABRAS_VACIAS.has(t));
  // Si el filtro se comio todo, volvemos a la base para no perder informacion.
  return tokens.length ? tokens.join(' ') : base;
}

/**
 * Normaliza un identificador fiscal (CUIT/RUC/NIF/EIN/VAT): solo alfanumericos en mayuscula.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizarIdFiscal(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/**
 * Normaliza un codigo de producto / SKU.
 * @param {unknown} s
 * @returns {string}
 */
export function normalizarCodigo(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** Alias de unidades de medida -> forma canonica. */
const ALIAS_UNIDADES = new Map(Object.entries({
  u: 'u', un: 'u', uni: 'u', unid: 'u', unidad: 'u', unidades: 'u', ea: 'u',
  each: 'u', pza: 'u', pieza: 'u', piezas: 'u', pc: 'u', pcs: 'u', c: 'u',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  g: 'g', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g',
  mg: 'mg', t: 'tn', tn: 'tn', ton: 'tn', tonelada: 'tn', toneladas: 'tn',
  l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l',
  ml: 'ml', cc: 'ml',
  m: 'm', mt: 'm', mts: 'm', metro: 'm', metros: 'm',
  cm: 'cm', mm: 'mm', m2: 'm2', m3: 'm3',
  caja: 'caja', cajas: 'caja', cj: 'caja', box: 'caja', boxes: 'caja',
  pack: 'pack', packs: 'pack', paq: 'pack', paquete: 'pack', paquetes: 'pack',
  docena: 'docena', docenas: 'docena', dz: 'docena', doz: 'docena',
  par: 'par', pares: 'par', pr: 'par',
  rollo: 'rollo', rollos: 'rollo',
  bolsa: 'bolsa', bolsas: 'bolsa',
  h: 'h', hs: 'h', hr: 'h', hrs: 'h', hora: 'h', horas: 'h', hour: 'h', hours: 'h',
  dia: 'dia', dias: 'dia', day: 'dia', days: 'dia',
  mes: 'mes', meses: 'mes', month: 'mes', months: 'mes',
  servicio: 'servicio', servicios: 'servicio', global: 'global'
}));

/**
 * @param {unknown} s
 * @returns {string} unidad canonica, o el texto normalizado si no se reconoce
 */
export function normalizarUnidad(s) {
  const base = normalizarTexto(s).replace(/\s+/g, '');
  if (!base) return '';
  return ALIAS_UNIDADES.get(base) ?? base;
}

/** Alias de moneda -> ISO 4217. */
const ALIAS_MONEDAS = new Map(Object.entries({
  usd: 'USD', us: 'USD', 'u$s': 'USD', us$: 'USD', dolar: 'USD', dolares: 'USD',
  dollar: 'USD', dollars: 'USD', '$': 'USD',
  eur: 'EUR', euro: 'EUR', euros: 'EUR', '€': 'EUR',
  ars: 'ARS', peso: 'ARS', pesos: 'ARS',
  brl: 'BRL', real: 'BRL', reales: 'BRL', 'r$': 'BRL',
  mxn: 'MXN', clp: 'CLP', cop: 'COP', pen: 'PEN', uyu: 'UYU', pyg: 'PYG',
  gbp: 'GBP', '£': 'GBP', jpy: 'JPY', '¥': 'JPY', chf: 'CHF', usdt: 'USDT'
}));

/**
 * @param {unknown} s
 * @returns {string} codigo ISO en mayusculas, o '' si no se puede determinar
 */
export function normalizarMoneda(s) {
  if (s === null || s === undefined) return '';
  const crudo = String(s).trim().toLowerCase();
  if (!crudo) return '';
  if (ALIAS_MONEDAS.has(crudo)) return ALIAS_MONEDAS.get(crudo);
  const limpio = quitarAcentos(crudo).replace(/[^a-z$€£¥]/g, '');
  if (ALIAS_MONEDAS.has(limpio)) return ALIAS_MONEDAS.get(limpio);
  return limpio.toUpperCase().slice(0, 4);
}

/**
 * Distancia de edicion de Levenshtein.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previa = new Array(b.length + 1);
  let actual = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) previa[j] = j;
  for (let i = 1; i <= a.length; i++) {
    actual[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(actual[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
    }
    const tmp = previa;
    previa = actual;
    actual = tmp;
  }
  return previa[b.length];
}

/**
 * Similitud por distancia de edicion, normalizada a 0..1.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similitudLevenshtein(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

/**
 * Jaro-Winkler: buena para errores tipograficos y variantes cortas.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function jaroWinkler(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const ventana = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const usadoA = new Array(a.length).fill(false);
  const usadoB = new Array(b.length).fill(false);
  let coincidencias = 0;

  for (let i = 0; i < a.length; i++) {
    const desde = Math.max(0, i - ventana);
    const hasta = Math.min(b.length - 1, i + ventana);
    for (let j = desde; j <= hasta; j++) {
      if (usadoB[j] || a[i] !== b[j]) continue;
      usadoA[i] = true;
      usadoB[j] = true;
      coincidencias++;
      break;
    }
  }
  if (coincidencias === 0) return 0;

  let transposiciones = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!usadoA[i]) continue;
    while (!usadoB[k]) k++;
    if (a[i] !== b[k]) transposiciones++;
    k++;
  }
  transposiciones /= 2;

  const jaro =
    (coincidencias / a.length + coincidencias / b.length +
      (coincidencias - transposiciones) / coincidencias) / 3;

  let prefijo = 0;
  const maxPrefijo = Math.min(4, a.length, b.length);
  while (prefijo < maxPrefijo && a[prefijo] === b[prefijo]) prefijo++;

  return jaro + prefijo * 0.1 * (1 - jaro);
}

/**
 * Similitud entre dos tokens, con soporte de abreviaturas por prefijo.
 * "distrib" ~ "distribuidora" => 0.95 sin necesidad de diccionario.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similitudToken(a, b) {
  if (a === b) return 1;
  const corto = a.length <= b.length ? a : b;
  const largo = a.length <= b.length ? b : a;
  if (corto.length >= 4 && largo.startsWith(corto)) return 0.95;
  if (corto.length >= 3 && largo.startsWith(corto) && largo.length - corto.length <= 3) return 0.85;
  const jw = jaroWinkler(a, b);
  return jw >= 0.88 ? jw : 0;
}

/**
 * Similitud de conjuntos de tokens con emparejamiento greedy 1 a 1.
 * Simetrica y ciega al orden de las palabras.
 * @param {string} a texto ya normalizado
 * @param {string} b texto ya normalizado
 * @returns {number} 0..1
 */
export function similitudTokens(a, b) {
  const ta = a ? a.split(' ').filter(Boolean) : [];
  const tb = b ? b.split(' ').filter(Boolean) : [];
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;

  const pares = [];
  for (let i = 0; i < ta.length; i++) {
    for (let j = 0; j < tb.length; j++) {
      const s = similitudToken(ta[i], tb[j]);
      if (s > 0) pares.push({ i, j, s });
    }
  }
  // Orden estable: score desc, luego indices asc. Garantiza determinismo.
  pares.sort((x, y) => y.s - x.s || x.i - y.i || x.j - y.j);

  const usadoA = new Set();
  const usadoB = new Set();
  let suma = 0;
  for (const par of pares) {
    if (usadoA.has(par.i) || usadoB.has(par.j)) continue;
    usadoA.add(par.i);
    usadoB.add(par.j);
    suma += par.s;
  }
  return (2 * suma) / (ta.length + tb.length);
}

/**
 * Similitud entre nombres de proveedor.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {{ score: number, normalizadoA: string, normalizadoB: string, metodo: string }}
 */
export function similitudProveedor(a, b) {
  const na = normalizarNombreEmpresa(a);
  const nb = normalizarNombreEmpresa(b);
  if (!na || !nb) {
    return { score: 0, normalizadoA: na, normalizadoB: nb, metodo: 'sin_datos' };
  }
  if (na === nb) {
    return { score: 1, normalizadoA: na, normalizadoB: nb, metodo: 'exacto_normalizado' };
  }
  const porTokens = similitudTokens(na, nb);
  const porCadena = jaroWinkler(na.replace(/ /g, ''), nb.replace(/ /g, ''));
  const score = Math.max(porTokens, porCadena);
  return {
    score: Number(score.toFixed(4)),
    normalizadoA: na,
    normalizadoB: nb,
    metodo: porTokens >= porCadena ? 'tokens' : 'jaro_winkler'
  };
}

/**
 * Similitud entre descripciones de item.
 * Da peso extra a los numeros presentes en la descripcion (medidas, modelos):
 * "cable 2.5mm" y "cable 4mm" no son el mismo producto.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {{ score: number, normalizadoA: string, normalizadoB: string, metodo: string }}
 */
export function similitudDescripcion(a, b) {
  const na = normalizarTexto(a);
  const nb = normalizarTexto(b);
  if (!na || !nb) {
    return { score: 0, normalizadoA: na, normalizadoB: nb, metodo: 'sin_datos' };
  }
  if (na === nb) {
    return { score: 1, normalizadoA: na, normalizadoB: nb, metodo: 'exacto_normalizado' };
  }

  const sinVacias = (t) => t.split(' ').filter((x) => x && !PALABRAS_VACIAS.has(x)).join(' ');
  let score = similitudTokens(sinVacias(na), sinVacias(nb));

  const numerosA = na.match(/\d+/g) ?? [];
  const numerosB = nb.match(/\d+/g) ?? [];
  if (numerosA.length || numerosB.length) {
    const setB = new Set(numerosB);
    const compartidos = numerosA.filter((n) => setB.has(n)).length;
    const totalDistintos = new Set([...numerosA, ...numerosB]).size;
    const acuerdoNumerico = totalDistintos ? compartidos / totalDistintos : 1;
    // Penaliza fuerte cuando los numeros no coinciden: suele ser otro producto.
    score = score * (0.7 + 0.3 * acuerdoNumerico);
  }

  return {
    score: Number(score.toFixed(4)),
    normalizadoA: na,
    normalizadoB: nb,
    metodo: 'tokens_con_numeros'
  };
}

/**
 * Similitud coseno entre dos vectores. Usada por la Capa 2 con embeddings.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let punto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i++) {
    punto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (normaA === 0 || normaB === 0) return 0;
  return punto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}
