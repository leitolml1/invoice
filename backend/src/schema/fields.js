/**
 * Lectura tolerante de "campos con confianza".
 *
 * CONTRATO CON PERSONA A
 * ----------------------
 * La forma canonica de cada campo extraido por OCR/IA es:
 *
 *   { "valor": <T|null>, "confianza": 0..1, "needs_review": boolean,
 *     "texto_crudo": "string opcional tal como se leyo", "bbox": [x,y,w,h] }
 *
 * Pero el parser tambien acepta:
 *   - un escalar pelado ("ACME SA" o 1234.56)  -> confianza = config.por_defecto_si_ausente
 *   - claves en ingles: value / confidence / needs_review / raw_text
 *   - null / ausente -> campo no presente, needs_review = true
 *
 * Esto nos deja integrar con Persona A aunque su salida difiera en detalles,
 * sin tocar el motor de matching.
 */

/**
 * @template T
 * @typedef {object} Campo
 * @property {T|null} valor valor normalizado y tipado
 * @property {unknown} valor_crudo lo que vino originalmente
 * @property {number} confianza 0..1
 * @property {boolean} needs_review bandera explicita de Persona A
 * @property {boolean} presente false si el campo no vino o vino null
 * @property {string|null} texto_crudo texto tal como lo leyo el OCR, si lo hay
 * @property {Record<string, unknown>} [extra] metadata adicional por campo
 */

/**
 * Devuelve la primera clave presente en el objeto.
 * @param {Record<string, unknown>|null|undefined} objeto
 * @param {...string} claves
 * @returns {unknown}
 */
export function elegir(objeto, ...claves) {
  if (!objeto || typeof objeto !== 'object') return undefined;
  for (const clave of claves) {
    if (clave in objeto && objeto[clave] !== undefined) return objeto[clave];
  }
  return undefined;
}

const CLAVES_VALOR = ['valor', 'value', 'val'];
const CLAVES_CONFIANZA = ['confianza', 'confidence', 'score', 'conf'];
const CLAVES_REVISION = ['needs_review', 'needsReview', 'requiere_revision', 'revisar', 'review'];
const CLAVES_CRUDO = ['texto_crudo', 'raw_text', 'rawText', 'raw', 'texto', 'text'];

/**
 * Determina si un objeto tiene forma de campo envuelto.
 * @param {unknown} v
 * @returns {boolean}
 */
function esCampoEnvuelto(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const claves = Object.keys(v);
  return (
    CLAVES_VALOR.some((c) => claves.includes(c)) ||
    CLAVES_CONFIANZA.some((c) => claves.includes(c)) ||
    CLAVES_REVISION.some((c) => claves.includes(c))
  );
}

/**
 * Lee un campo, envuelto o pelado, y lo normaliza.
 *
 * @template T
 * @param {unknown} crudo
 * @param {object} [opciones]
 * @param {(v: unknown) => T|null} [opciones.transformar] normalizador de tipo
 * @param {number} [opciones.confianzaPorDefecto]
 * @param {Record<string, unknown>} [opciones.extra]
 * @returns {Campo<T>}
 */
export function leerCampo(crudo, opciones = {}) {
  const confianzaPorDefecto =
    typeof opciones.confianzaPorDefecto === 'number' ? opciones.confianzaPorDefecto : 1;
  const transformar = opciones.transformar ?? ((v) => (v === undefined ? null : v));

  let valorCrudo;
  let confianza = confianzaPorDefecto;
  let needsReview = false;
  let textoCrudo = null;
  let extra = { ...(opciones.extra ?? {}) };

  if (esCampoEnvuelto(crudo)) {
    const objeto = /** @type {Record<string, unknown>} */ (crudo);
    valorCrudo = elegir(objeto, ...CLAVES_VALOR);
    const c = elegir(objeto, ...CLAVES_CONFIANZA);
    if (typeof c === 'number' && Number.isFinite(c)) {
      // Acepta 0..1 o 0..100.
      confianza = c > 1 ? Math.min(1, c / 100) : Math.max(0, c);
    }
    const r = elegir(objeto, ...CLAVES_REVISION);
    if (typeof r === 'boolean') needsReview = r;
    const t = elegir(objeto, ...CLAVES_CRUDO);
    if (typeof t === 'string') textoCrudo = t;
    const bbox = elegir(objeto, 'bbox', 'box', 'bounding_box');
    if (bbox !== undefined) extra.bbox = bbox;
    const pagina = elegir(objeto, 'pagina', 'page');
    if (pagina !== undefined) extra.pagina = pagina;
  } else {
    valorCrudo = crudo;
  }

  const vacio =
    valorCrudo === undefined ||
    valorCrudo === null ||
    (typeof valorCrudo === 'string' && valorCrudo.trim() === '');

  const valor = vacio ? null : transformar(valorCrudo);
  const presente = valor !== null && valor !== undefined && !Number.isNaN(valor);

  return {
    valor: presente ? valor : null,
    valor_crudo: valorCrudo ?? null,
    confianza: presente ? confianza : 0,
    needs_review: needsReview || !presente,
    presente,
    texto_crudo: textoCrudo,
    extra
  };
}

/**
 * Construye un campo sintetico (usado cuando el motor deriva un valor).
 * @template T
 * @param {T|null} valor
 * @param {number} [confianza]
 * @returns {Campo<T>}
 */
export function campoDerivado(valor, confianza = 1) {
  const presente = valor !== null && valor !== undefined;
  return {
    valor: presente ? valor : null,
    valor_crudo: valor ?? null,
    confianza: presente ? confianza : 0,
    needs_review: !presente,
    presente,
    texto_crudo: null,
    extra: { derivado: true }
  };
}

/**
 * True si el campo esta por debajo del umbral de confianza o marcado para revision.
 * @param {Campo<unknown>} campo
 * @param {number} umbral
 * @returns {boolean}
 */
export function esDudoso(campo, umbral) {
  if (!campo) return true;
  if (!campo.presente) return true;
  if (campo.needs_review) return true;
  return campo.confianza < umbral;
}

/**
 * Serializa un campo a la forma canonica del contrato (para devolver a Persona C).
 * @param {Campo<unknown>} campo
 * @returns {{valor: unknown, confianza: number, needs_review: boolean, texto_crudo: string|null}}
 */
export function serializarCampo(campo) {
  return {
    valor: campo?.valor ?? null,
    confianza: campo?.confianza ?? 0,
    needs_review: campo?.needs_review ?? true,
    texto_crudo: campo?.texto_crudo ?? null
  };
}
