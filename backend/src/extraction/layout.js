/**
 * Reconstruccion de layout a partir de los bloques del OCR. 100% determinisitico.
 *
 * Por que existe este archivo: el OCR devuelve bloques sueltos con bbox. Si se
 * los pasa al LLM en el orden crudo, el modelo pierde la estructura de tabla y
 * mezcla columnas de filas distintas. Probado en esta maquina: con
 * `paragraph: true` el propio OCR fusiona filas diferentes
 * ("Switch 24 puertos Gigabit Patch panel 24 bocas" en un solo bloque), asi que
 * usamos `paragraph: false` y agrupamos nosotros por coordenadas.
 *
 * bbox del SDK: [x1, y1, x2, y2] (verificado contra la salida real de ocr()).
 */

/**
 * @typedef {{ text: string, bbox?: [number, number, number, number], confidence?: number }} BloqueOcr
 */

/**
 * @typedef {object} Celda
 * @property {string} texto
 * @property {number} confianza
 * @property {number} x1
 * @property {number} x2
 * @property {number} y1
 * @property {number} y2
 */

/**
 * @typedef {object} Fila
 * @property {number} y centro vertical
 * @property {Celda[]} celdas ordenadas por x
 * @property {number} confianza_min
 */

/**
 * Convierte bloques del OCR en celdas normalizadas, descartando vacios.
 * @param {BloqueOcr[]} bloques
 * @returns {Celda[]}
 */
export function aCeldas(bloques) {
  const celdas = [];
  for (const b of bloques) {
    const texto = (b.text ?? '').trim();
    if (!texto) continue;
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = b.bbox ?? [];
    celdas.push({
      texto,
      confianza: typeof b.confidence === 'number' ? b.confidence : 1,
      x1,
      y1,
      x2,
      y2
    });
  }
  return celdas;
}

/** Centro horizontal de una celda. @param {Celda} c @returns {number} */
export function centroX(c) {
  return (c.x1 + c.x2) / 2;
}

/** Centro vertical de una celda. @param {Celda} c @returns {number} */
export function centroY(c) {
  return (c.y1 + c.y2) / 2;
}

/**
 * Estima la inclinacion del documento como la pendiente dy/dx de una recta
 * ajustada por minimos cuadrados sobre los centros de un conjunto de celdas
 * que se sabe que pertenecen a la misma linea visual.
 *
 * Por que hace falta: en un escaneo torcido el centro vertical de una fila
 * deriva de izquierda a derecha. Medido en factura-02-escaneada, la deriva
 * dentro de una fila es de 25 px mientras la separacion entre filas es de
 * 34 px. Con esa proporcion cualquier agrupamiento por cercania vertical
 * encadena filas distintas, porque la ultima celda de una fila queda mas
 * cerca de la primera de la siguiente que de su propio comienzo.
 *
 * Se le pasan las celdas del encabezado de la tabla, que son la referencia
 * mas confiable: son una sola linea real y estan repartidas a lo ancho.
 *
 * @param {Celda[]} celdasDeUnaLinea
 * @returns {number} pendiente; 0 si no hay datos suficientes
 */
export function estimarInclinacion(celdasDeUnaLinea) {
  const puntos = celdasDeUnaLinea.map((c) => ({ x: centroX(c), y: centroY(c) }));
  if (puntos.length < 2) return 0;

  const n = puntos.length;
  const mediaX = puntos.reduce((a, p) => a + p.x, 0) / n;
  const mediaY = puntos.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of puntos) {
    num += (p.x - mediaX) * (p.y - mediaY);
    den += (p.x - mediaX) ** 2;
  }
  if (den === 0) return 0;

  const pendiente = num / den;
  // Mas de ~11 grados no es un escaneo torcido, es otra cosa: no corregimos
  // para no empeorar un documento que en realidad esta derecho.
  if (!Number.isFinite(pendiente) || Math.abs(pendiente) > 0.2) return 0;
  return pendiente;
}

/**
 * Y de una celda corregido por inclinacion, referido a x = 0.
 * @param {Celda} c
 * @param {number} pendiente
 * @returns {number}
 */
export function yCorregido(c, pendiente) {
  return centroY(c) - pendiente * centroX(c);
}

/**
 * Agrupa celdas en filas.
 *
 * Sin `pendiente` usa solapamiento vertical de los rangos, que alcanza para
 * documentos derechos. Con `pendiente` agrupa por cercania de los centros
 * verticales corregidos, que es lo unico que separa bien las filas de un
 * escaneo torcido.
 *
 * El modo con pendiente compara cada celda contra el promedio corrido del
 * grupo, no contra su extension acumulada. Esa diferencia importa: comparar
 * contra la extension hace que el grupo crezca y absorba cada vez mas celdas,
 * que es exactamente como las tres filas de items de factura-02 terminaban
 * fusionadas en una.
 *
 * @param {Celda[]} celdas
 * @param {{ solapeMinimo?: number, pendiente?: number, toleranciaFila?: number }} [opciones]
 * @returns {Fila[]}
 */
export function agruparEnFilas(celdas, opciones = {}) {
  const pendiente = opciones.pendiente ?? 0;

  const armar = (grupos) =>
    grupos
      .map((g) => {
        const celdasOrdenadas = [...g.celdas].sort((a, b) => a.x1 - b.x1);
        return {
          y: Math.round((g.y1 + g.y2) / 2),
          celdas: celdasOrdenadas,
          confianza_min: celdasOrdenadas.reduce((min, c) => Math.min(min, c.confianza), 1)
        };
      })
      .sort((a, b) => a.y - b.y);

  if (pendiente !== 0) {
    const alturas = celdas.map((c) => Math.max(1, c.y2 - c.y1)).sort((a, b) => a - b);
    const alturaMediana = alturas[Math.floor(alturas.length / 2)] ?? 20;
    // Media altura de texto: mas chico parte filas reales, mas grande las fusiona.
    const tolerancia = opciones.toleranciaFila ?? alturaMediana * 0.6;

    const ordenadas = [...celdas].sort((a, b) => yCorregido(a, pendiente) - yCorregido(b, pendiente));
    /** @type {{ suma: number, n: number, y1: number, y2: number, celdas: Celda[] }[]} */
    const grupos = [];
    for (const celda of ordenadas) {
      const y = yCorregido(celda, pendiente);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && Math.abs(y - ultimo.suma / ultimo.n) <= tolerancia) {
        ultimo.celdas.push(celda);
        ultimo.suma += y;
        ultimo.n += 1;
        ultimo.y1 = Math.min(ultimo.y1, celda.y1);
        ultimo.y2 = Math.max(ultimo.y2, celda.y2);
      } else {
        grupos.push({ suma: y, n: 1, y1: celda.y1, y2: celda.y2, celdas: [celda] });
      }
    }
    return armar(grupos);
  }

  const solapeMinimo = opciones.solapeMinimo ?? 0.35;
  const ordenadas = [...celdas].sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  /** @type {{ y1: number, y2: number, celdas: Celda[] }[]} */
  const grupos = [];

  for (const celda of ordenadas) {
    const altura = Math.max(1, celda.y2 - celda.y1);
    let destino = null;
    for (const grupo of grupos) {
      const solape = Math.min(grupo.y2, celda.y2) - Math.max(grupo.y1, celda.y1);
      const alturaGrupo = Math.max(1, grupo.y2 - grupo.y1);
      const referencia = Math.min(altura, alturaGrupo);
      if (solape / referencia >= solapeMinimo) {
        destino = grupo;
        break;
      }
    }
    if (destino) {
      destino.celdas.push(celda);
      destino.y1 = Math.min(destino.y1, celda.y1);
      destino.y2 = Math.max(destino.y2, celda.y2);
    } else {
      grupos.push({ y1: celda.y1, y2: celda.y2, celdas: [celda] });
    }
  }

  return armar(grupos);
}

/**
 * Serializa las filas como texto tabular para el prompt del estructurador.
 * Las columnas se separan con " | " y se anota la coordenada x de cada celda,
 * que le da al modelo la pista de alineacion vertical entre filas.
 *
 * @param {Fila[]} filas
 * @param {{ incluirCoordenadas?: boolean }} [opciones]
 * @returns {string}
 */
export function filasATexto(filas, opciones = {}) {
  const incluirCoordenadas = opciones.incluirCoordenadas ?? true;
  return filas
    .map((fila) => {
      const celdas = fila.celdas.map((c) =>
        incluirCoordenadas ? `${c.texto}@x${Math.round(c.x1)}` : c.texto
      );
      return celdas.join(' | ');
    })
    .join('\n');
}

/**
 * Texto plano de todo el documento, normalizado sin espacios.
 * Se usa para verificar que los valores que devuelve el LLM existan de verdad
 * en el documento (guarda anti-alucinacion).
 *
 * @param {Celda[]} celdas
 * @returns {string}
 */
export function textoCompactado(celdas) {
  return celdas
    .map((c) => c.texto)
    .join(' ')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Busca la confianza del OCR para un valor extraido por el LLM.
 *
 * Devuelve la confianza del bloque cuyo texto contiene el valor (comparando sin
 * espacios). Si ningun bloque lo contiene, el valor no esta respaldado por el
 * OCR: devuelve `null`, y quien llama debe marcar needs_review.
 *
 * @param {Celda[]} celdas
 * @param {string|number|null|undefined} valor
 * @returns {{ confianza: number, texto_fuente: string }|null}
 */
export function confianzaDeValor(celdas, valor) {
  if (valor === null || valor === undefined) return null;
  const buscado = String(valor).replace(/\s+/g, '').toLowerCase();
  if (!buscado) return null;

  let mejor = null;
  for (const celda of celdas) {
    const texto = celda.texto.replace(/\s+/g, '').toLowerCase();
    if (!texto.includes(buscado)) continue;
    // Preferimos el bloque mas corto: es el que mas "se parece" al valor solo.
    if (!mejor || texto.length < mejor.longitud) {
      mejor = { confianza: celda.confianza, texto_fuente: celda.texto, longitud: texto.length };
    }
  }
  if (!mejor) return null;
  return { confianza: mejor.confianza, texto_fuente: mejor.texto_fuente };
}
