/**
 * Reconstruccion de la tabla de items por bandas de posicion X. 100% determinisitico.
 *
 * Por que existe este archivo: antes la asignacion de valores a columnas la
 * hacia el LLM, guiado por una anotacion `TEXTO@xN` incrustada en el texto del
 * prompt. Eso fallaba de dos maneras. Una, el modelo no tiene forma confiable
 * de decidir a que columna pertenece un numero a partir de una coordenada
 * suelta. Dos, copiaba la propia anotacion dentro de los valores extraidos.
 *
 * Ahora las columnas se resuelven en codigo, antes de que el modelo vea nada:
 *
 *   1. Se ubica la fila de encabezados de la tabla (CODIGO, DESCRIPCION, CANT,
 *      PUNIT, IMPORTE o sus sinonimos).
 *   2. Cada encabezado define una banda horizontal. Los limites son los puntos
 *      medios entre encabezados vecinos; la primera y la ultima quedan
 *      abiertas.
 *   3. Cada celda de las filas siguientes se asigna a la banda con la que mas
 *      se solapa horizontalmente.
 *
 * Por que los limites son los puntos medios y no el ancho del encabezado:
 * medido en factura-01, "305m" ocupa x 345-391 mientras el encabezado
 * DESCRIPCION ocupa 185-305. Con bandas del ancho del encabezado ese valor
 * quedaba huerfano. Con puntos medios, DESCRIPCION cubre 159-448 y lo toma.
 *
 * El caso que justifica todo esto: en las filas 2 y 3 hay un "24" que pertenece
 * a la descripcion ("Switch 24 puertos", "Patch panel 24 bocas"), con centro en
 * 358 y 357. Cae dentro de la banda DESCRIPCION, asi que por construccion no
 * puede terminar interpretado como cantidad.
 */

import { quitarAcentos } from '../util/text.js';
import { centroX } from './layout.js';

/** Columnas que sabemos reconocer, en el orden del contrato de salida. */
export const ROLES = Object.freeze([
  'codigo',
  'descripcion',
  'cantidad',
  'unidad',
  'precio_unitario',
  'total'
]);

/** Roles cuyo contenido es numerico y por lo tanto se normaliza. */
const ROLES_NUMERICOS = new Set(['cantidad', 'precio_unitario', 'total']);

/**
 * Sinonimos de encabezado por rol. Se comparan contra el texto normalizado
 * (mayusculas, sin acentos, sin puntuacion), asi "P.UNIT" y "P UNIT" caen
 * ambos en "PUNIT". El orden importa: se evalua de arriba hacia abajo, y los
 * roles mas especificos van primero para que "PRECIO UNITARIO" no lo capture
 * un sinonimo mas generico.
 */
const SINONIMOS = Object.freeze([
  ['cantidad', ['CANT', 'CANTIDAD', 'CTD', 'CTDAD', 'CDAD', 'QTY', 'UNIDADES']],
  [
    'precio_unitario',
    ['PUNIT', 'PRECIOUNITARIO', 'PRECIOUNIT', 'PRECIO', 'PU', 'VALORUNITARIO', 'UNITPRICE', 'PRICE']
  ],
  ['total', ['IMPORTE', 'TOTAL', 'MONTO', 'VALORTOTAL', 'AMOUNT', 'SUBTOTALLINEA']],
  ['unidad', ['UNIDAD', 'UM', 'UNID', 'MEDIDA']],
  ['codigo', ['CODIGO', 'COD', 'SKU', 'REFERENCIA', 'REF', 'CODE']],
  ['descripcion', ['DESCRIPCION', 'DETALLE', 'CONCEPTO', 'PRODUCTO', 'DESCRIPTION', 'ARTICULO']]
]);

/** Palabras que delatan el bloque de totales, donde termina la tabla de items. */
const PALABRAS_TOTALES = Object.freeze([
  'SUBTOTAL',
  'TOTAL',
  'IVA',
  'IMPUESTO',
  'IMPUESTOS',
  'DESCUENTO',
  'NETO',
  'GRAVADO',
  'PERCEPCION',
  'RETENCION'
]);

/**
 * Normaliza texto de encabezado: mayusculas, sin acentos, solo alfanumerico.
 * @param {string} s
 * @returns {string}
 */
export function normalizarEncabezado(s) {
  return quitarAcentos(String(s ?? ''))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Mapea el texto de una celda de encabezado a un rol conocido.
 * @param {string} texto
 * @returns {string|null}
 */
export function rolDeEncabezado(texto) {
  const n = normalizarEncabezado(texto);
  if (!n) return null;
  for (const [rol, claves] of SINONIMOS) {
    if (claves.includes(n)) return rol;
  }
  // Segunda pasada mas laxa: el encabezado contiene el sinonimo (ej. "CANT.")
  for (const [rol, claves] of SINONIMOS) {
    for (const clave of claves) {
      if (clave.length >= 3 && n.includes(clave)) return rol;
    }
  }
  return null;
}

/**
 * @typedef {object} Columna
 * @property {string} rol
 * @property {string} texto texto del encabezado tal como se leyo
 * @property {number} x1
 * @property {number} x2
 */

/**
 * @typedef {object} Banda
 * @property {string} rol
 * @property {number} desde limite izquierdo (puede ser -Infinity)
 * @property {number} hasta limite derecho (puede ser +Infinity)
 */

/**
 * Busca la fila que es el encabezado de la tabla de items.
 *
 * Criterio: al menos 3 celdas que mapean a roles distintos, y entre ellas al
 * menos una columna numerica (cantidad, precio o total). Sin esa segunda
 * condicion, un bloque de direccion con la palabra "REF" podria pasar por
 * encabezado.
 *
 * @param {import('./layout.js').Fila[]} filas
 * @returns {{ indice: number, fila: import('./layout.js').Fila, columnas: Columna[] }|null}
 */
export function detectarEncabezadoTabla(filas) {
  let mejor = null;

  for (let i = 0; i < filas.length; i++) {
    /** @type {Columna[]} */
    const columnas = [];
    const vistos = new Set();
    for (const celda of filas[i].celdas) {
      const rol = rolDeEncabezado(celda.texto);
      if (!rol || vistos.has(rol)) continue;
      vistos.add(rol);
      columnas.push({ rol, texto: celda.texto, x1: celda.x1, x2: celda.x2 });
    }

    const tieneNumerica = columnas.some((c) => ROLES_NUMERICOS.has(c.rol));
    if (columnas.length < 3 || !tieneNumerica) continue;

    if (!mejor || columnas.length > mejor.columnas.length) {
      mejor = { indice: i, fila: filas[i], columnas: columnas.sort((a, b) => a.x1 - b.x1) };
    }
  }

  return mejor;
}

/**
 * Convierte las columnas del encabezado en bandas horizontales contiguas.
 *
 * Los limites interiores son el punto medio entre el borde derecho de una
 * columna y el borde izquierdo de la siguiente. Los extremos quedan abiertos
 * para que nada se caiga por los costados.
 *
 * @param {Columna[]} columnas ordenadas por x
 * @returns {Banda[]}
 */
export function calcularBandas(columnas) {
  const orden = [...columnas].sort((a, b) => a.x1 - b.x1);
  return orden.map((col, i) => ({
    rol: col.rol,
    desde: i === 0 ? -Infinity : (orden[i - 1].x2 + col.x1) / 2,
    hasta: i === orden.length - 1 ? Infinity : (col.x2 + orden[i + 1].x1) / 2
  }));
}

/**
 * Devuelve la banda a la que corresponde una celda, por maximo solapamiento
 * horizontal. Si no solapa con ninguna, cae en la de centro mas cercano.
 *
 * El maximo solapamiento importa cuando una celda cruza un limite: en
 * factura-01, "24 puertos Gigabit" ocupa x 260-456 y el limite
 * DESCRIPCION/CANT esta en 448. Solapa 188 px con DESCRIPCION y 8 con CANT,
 * asi que va a DESCRIPCION, que es lo correcto.
 *
 * @param {import('./layout.js').Celda} celda
 * @param {Banda[]} bandas
 * @returns {Banda|null}
 */
export function bandaDeCelda(celda, bandas) {
  if (!bandas.length) return null;
  const LIMITE = 1e9;
  let mejor = null;
  let mejorSolape = 0;

  for (const banda of bandas) {
    const desde = banda.desde === -Infinity ? -LIMITE : banda.desde;
    const hasta = banda.hasta === Infinity ? LIMITE : banda.hasta;
    const solape = Math.min(hasta, celda.x2) - Math.max(desde, celda.x1);
    if (solape > mejorSolape) {
      mejorSolape = solape;
      mejor = banda;
    }
  }
  if (mejor) return mejor;

  const cx = centroX(celda);
  let menorDistancia = Infinity;
  for (const banda of bandas) {
    const desde = banda.desde === -Infinity ? -LIMITE : banda.desde;
    const hasta = banda.hasta === Infinity ? LIMITE : banda.hasta;
    const centro = (desde + hasta) / 2;
    const d = Math.abs(cx - centro);
    if (d < menorDistancia) {
      menorDistancia = d;
      mejor = banda;
    }
  }
  return mejor;
}

/**
 * Normaliza el texto de una celda numerica.
 *
 * Solo aplica transformaciones que correspondan a un patron explicito. Si el
 * texto no encaja en ninguno se devuelve tal cual: es preferible que el valor
 * llegue crudo y quede marcado para revision que corregirlo mal en silencio.
 *
 * Casos reales que resuelve, medidos sobre las 3 facturas de prueba:
 *   "196 .00"  -> "196.00"   espacio antes del separador
 *   "1986,82"  -> "1986.82"  coma decimal
 *   "1026 00"  -> "1026.00"  el separador se perdio y quedo un espacio
 *   "1.026,00" -> "1026.00"  formato con punto de miles
 *
 * @param {string} texto
 * @returns {string}
 */
export function normalizarNumero(texto) {
  const s = String(texto ?? '').trim();
  if (!s) return s;

  // 1.026,00 / 1.026.500,00  -> miles con punto, decimal con coma
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) {
    return s.replace(/\./g, '').replace(',', '.');
  }
  // 1,026.00 -> miles con coma, decimal con punto
  if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) {
    return s.replace(/,/g, '');
  }
  // 1986,82 -> coma decimal
  if (/^-?\d+,\d{1,2}$/.test(s)) {
    return s.replace(',', '.');
  }
  // "196 .00" / "85 . 50" -> espacios alrededor del separador
  if (/^-?\d+\s*[.,]\s*\d{1,2}$/.test(s)) {
    return s.replace(/\s+/g, '').replace(',', '.');
  }
  // "1026 00" -> el separador decimal se perdio en el OCR
  if (/^-?\d+\s+\d{2}$/.test(s)) {
    return s.replace(/\s+/, '.');
  }
  // 1.026 -> punto de miles sin decimales (3 digitos exactos a la derecha)
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    return s.replace(/\./g, '');
  }
  return s;
}

/**
 * @typedef {object} FilaItem
 * @property {number} y
 * @property {Record<string, string>} valores por rol
 * @property {number} confianza_min
 */

/**
 * Reparte las celdas de una fila entre las bandas.
 * Varias celdas en la misma banda se concatenan en orden de x.
 *
 * @param {import('./layout.js').Fila} fila
 * @param {Banda[]} bandas
 * @returns {Record<string, string>}
 */
export function asignarFila(fila, bandas) {
  /** @type {Record<string, import('./layout.js').Celda[]>} */
  const porRol = {};
  for (const celda of fila.celdas) {
    const banda = bandaDeCelda(celda, bandas);
    if (!banda) continue;
    (porRol[banda.rol] ??= []).push(celda);
  }

  /** @type {Record<string, string>} */
  const valores = {};
  for (const [rol, celdas] of Object.entries(porRol)) {
    const texto = celdas
      .sort((a, b) => a.x1 - b.x1)
      .map((c) => c.texto.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    valores[rol] = ROLES_NUMERICOS.has(rol) ? normalizarNumero(texto) : texto;
  }
  return valores;
}

/**
 * @param {import('./layout.js').Fila} fila
 * @returns {boolean}
 */
function pareceTotales(fila) {
  return fila.celdas.some((c) => {
    const n = normalizarEncabezado(c.texto);
    return PALABRAS_TOTALES.some((p) => n === p || n.startsWith(p));
  });
}

/**
 * Extrae las filas de items que siguen al encabezado.
 *
 * Una fila cuenta como item si tiene algo en codigo o descripcion, y ademas
 * algo en precio o total. El recorrido corta en el bloque de totales, para no
 * arrastrar el pie del documento.
 *
 * @param {import('./layout.js').Fila[]} filas
 * @param {number} indiceEncabezado
 * @param {Banda[]} bandas
 * @returns {FilaItem[]}
 */
export function extraerFilasItems(filas, indiceEncabezado, bandas) {
  /** @type {FilaItem[]} */
  const items = [];

  for (let i = indiceEncabezado + 1; i < filas.length; i++) {
    const fila = filas[i];
    const valores = asignarFila(fila, bandas);

    const tieneIdentidad = Boolean(valores.codigo || valores.descripcion);
    const tieneMonto = Boolean(valores.total || valores.precio_unitario);

    if (!tieneIdentidad && pareceTotales(fila)) break;
    if (!tieneIdentidad || !tieneMonto) continue;
    if (pareceTotales(fila) && !valores.codigo) break;

    items.push({ y: fila.y, valores, confianza_min: fila.confianza_min });
  }

  return items;
}

/**
 * Serializa la tabla de items ya alineada, en formato pipe con encabezado.
 * No lleva coordenadas: el modelo ya no las necesita, porque las columnas
 * vienen resueltas.
 *
 * @param {FilaItem[]} items
 * @param {Banda[]} bandas
 * @returns {string}
 */
export function tablaItemsATexto(items, bandas) {
  const roles = ROLES.filter((r) => bandas.some((b) => b.rol === r));
  const lineas = [roles.join(' | ')];
  for (const item of items) {
    lineas.push(roles.map((r) => item.valores[r] ?? '').join(' | '));
  }
  return lineas.join('\n');
}

/**
 * Texto de las filas que no son parte de la tabla de items: encabezado del
 * documento y bloque de totales. Sin coordenadas.
 *
 * @param {import('./layout.js').Fila[]} filas
 * @param {number[]} indicesExcluidos
 * @returns {string}
 */
export function filasSueltasATexto(filas, indicesExcluidos) {
  const excluir = new Set(indicesExcluidos);
  return filas
    .map((fila, i) => (excluir.has(i) ? null : fila.celdas.map((c) => c.texto.trim()).join(' | ')))
    .filter((l) => l && l.trim())
    .join('\n');
}

/**
 * Reconstruye la tabla completa a partir de las filas del layout.
 *
 * @param {import('./layout.js').Fila[]} filas
 * @returns {{
 *   encabezado: { indice: number, columnas: Columna[] }|null,
 *   bandas: Banda[],
 *   items: FilaItem[],
 *   indices_items: number[]
 * }}
 */
export function reconstruirTabla(filas) {
  const encabezado = detectarEncabezadoTabla(filas);
  if (!encabezado) {
    return { encabezado: null, bandas: [], items: [], indices_items: [] };
  }
  const bandas = calcularBandas(encabezado.columnas);
  const items = extraerFilasItems(filas, encabezado.indice, bandas);
  const indicesItems = filas
    .map((f, i) => (items.some((it) => it.y === f.y) ? i : -1))
    .filter((i) => i >= 0);

  return {
    encabezado: { indice: encabezado.indice, columnas: encabezado.columnas },
    bandas,
    items,
    indices_items: indicesItems
  };
}

/**
 * Arma el texto que recibe el LLM: dos bloques, sin anotaciones de coordenadas.
 *
 * Antes se le pasaba una sola lista de renglones con la coordenada pegada a
 * cada celda (`TEXTO@x185`). El modelo copiaba esa anotacion dentro de los
 * valores, y como esos valores ya no coincidian con ningun bloque del OCR, la
 * verificacion anti-alucinacion los marcaba a todos como posible invencion.
 * Separando la tabla y quitando las coordenadas, el modelo no tiene nada
 * ajeno que copiar.
 *
 * @param {import('./layout.js').Fila[]} filas
 * @param {ReturnType<typeof reconstruirTabla>} tabla
 * @returns {string}
 */
export function construirEntradaLlm(filas, tabla) {
  const excluidas = [
    ...(tabla.encabezado ? [tabla.encabezado.indice] : []),
    ...tabla.indices_items
  ];
  const sueltas = filasSueltasATexto(filas, excluidas);

  const partes = [`DATOS DEL DOCUMENTO:\n${sueltas}`];

  if (tabla.items.length) {
    partes.push(
      'TABLA DE ITEMS (columnas ya resueltas por posicion, una linea por item):\n' +
        tablaItemsATexto(tabla.items, tabla.bandas)
    );
  } else {
    partes.push(
      'TABLA DE ITEMS: no se pudo reconstruir la tabla por posicion. Si hay items, ' +
        'estan entre los renglones de DATOS DEL DOCUMENTO.'
    );
  }

  return partes.join('\n\n');
}
