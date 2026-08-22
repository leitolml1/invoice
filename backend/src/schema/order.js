/**
 * FUENTE DE VERDAD: Orden de compra / extracto.
 *
 * Se acepta JSON (una orden o un array) y CSV plano (una fila por item,
 * agrupado por orden_id). A diferencia de la factura, aca NO hay campos de
 * confianza: es un dato del sistema, no una lectura de OCR.
 *
 * JSON canonico (ver contracts/orden-compra.schema.json):
 * {
 *   "schema_version": "1.0.0",
 *   "orden_id": "PO-2026-0001",
 *   "proveedor": { "nombre": "ACME SA", "identificacion_fiscal": "30-71234567-9" },
 *   "fecha_emision": "2026-07-01",
 *   "fecha_entrega_esperada": "2026-07-20",
 *   "moneda": "USD",
 *   "condiciones_pago": "30 dias",
 *   "items": [ { "linea": 1, "codigo": "SKU-100", "descripcion": "...",
 *                "cantidad": 10, "unidad": "u", "precio_unitario": 25.5,
 *                "importe_linea": 255 } ],
 *   "totales": { "subtotal": 255, "impuestos": 53.55, "descuentos": 0, "total": 308.55 }
 * }
 *
 * CSV: columnas orden_id, proveedor_nombre, proveedor_id_fiscal, fecha_emision,
 * fecha_entrega_esperada, moneda, linea, codigo, descripcion, cantidad, unidad,
 * precio_unitario, importe_linea, impuestos_total, descuentos_total
 */

import { parsearCsv } from '../util/csv.js';
import { parsearMonto, aCentavos, aMilesimas } from '../util/money.js';
import { parsearFecha } from '../util/dates.js';
import { normalizarMoneda, normalizarUnidad, normalizarCodigo } from '../util/text.js';
import { elegir } from './fields.js';

export const VERSION_ESQUEMA_ORDEN = '1.0.0';

/**
 * @typedef {object} ItemOrdenNormalizado
 * @property {number} linea
 * @property {string|null} codigo
 * @property {string} codigo_normalizado
 * @property {string|null} descripcion
 * @property {number|null} cantidad
 * @property {number|null} cantidad_milesimas
 * @property {string|null} unidad
 * @property {number|null} precio_unitario
 * @property {number|null} precio_unitario_centavos
 * @property {number|null} importe_linea
 * @property {number|null} importe_linea_centavos
 */

/**
 * @typedef {object} OrdenNormalizada
 * @property {string} schema_version
 * @property {string} orden_id
 * @property {{ nombre: string|null, identificacion_fiscal: string|null }} proveedor
 * @property {string|null} fecha_emision ISO
 * @property {string|null} fecha_entrega_esperada ISO
 * @property {string} moneda
 * @property {string|null} condiciones_pago
 * @property {ItemOrdenNormalizado[]} items
 * @property {{ subtotal: number|null, impuestos: number|null, descuentos: number|null, total: number|null }} totales
 * @property {{ subtotal: number|null, impuestos: number|null, descuentos: number|null, total: number|null }} totales_centavos
 * @property {object} [tolerancias] override de tolerancias para esta orden
 * @property {string[]} advertencias
 */

/**
 * Normaliza una orden de compra en formato JSON.
 * @param {unknown} entrada
 * @param {object} [config]
 * @returns {OrdenNormalizada}
 */
export function parsearOrden(entrada, config = {}) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new TypeError('parsearOrden: se esperaba un objeto con la orden de compra');
  }
  const raiz = /** @type {Record<string, unknown>} */ (entrada);
  const advertencias = [];
  const preferirFecha = config?.formato_fecha_preferido ?? 'dmy';

  const proveedorCrudo = elegir(raiz, 'proveedor', 'supplier', 'vendor') ?? {};
  const proveedorObj =
    typeof proveedorCrudo === 'object' && proveedorCrudo !== null
      ? /** @type {Record<string, unknown>} */ (proveedorCrudo)
      : { nombre: proveedorCrudo };

  const nombre = elegir(proveedorObj, 'nombre', 'name', 'razon_social');
  const idFiscal = elegir(
    proveedorObj, 'identificacion_fiscal', 'tax_id', 'cuit', 'ruc', 'nif', 'vat', 'ein'
  );

  const fechaEmision = parsearFecha(
    elegir(raiz, 'fecha_emision', 'fecha', 'date', 'order_date'),
    { preferir: preferirFecha }
  );
  const fechaEntrega = parsearFecha(
    elegir(raiz, 'fecha_entrega_esperada', 'fecha_entrega', 'delivery_date', 'expected_delivery'),
    { preferir: preferirFecha }
  );

  const itemsCrudos = elegir(raiz, 'items', 'line_items', 'lineas', 'detalle');
  const items = Array.isArray(itemsCrudos)
    ? itemsCrudos.map((it, i) => normalizarItemOrden(it, i, advertencias))
    : [];
  if (!items.length) advertencias.push('la orden no tiene items');

  const totalesCrudos = elegir(raiz, 'totales', 'totals') ?? raiz;
  const totalesObj = /** @type {Record<string, unknown>} */ (totalesCrudos);

  let subtotal = parsearMonto(elegir(totalesObj, 'subtotal', 'neto', 'net'));
  const impuestos = parsearMonto(elegir(totalesObj, 'impuestos', 'tax', 'taxes', 'iva', 'vat'));
  const descuentos = parsearMonto(elegir(totalesObj, 'descuentos', 'descuento', 'discount'));
  let total = parsearMonto(elegir(totalesObj, 'total', 'importe_total', 'grand_total'));

  // Derivamos lo que falte a partir de los items (la OC es la verdad, tiene que cerrar).
  const sumaLineasCentavos = items.reduce(
    (acc, it) => acc + (it.importe_linea_centavos ?? 0),
    0
  );
  if (subtotal === null && items.length) {
    subtotal = Number((sumaLineasCentavos / 100).toFixed(2));
  }
  if (total === null) {
    const subCent = subtotal === null ? sumaLineasCentavos : aCentavos(subtotal) ?? 0;
    const impCent = impuestos === null ? 0 : aCentavos(impuestos) ?? 0;
    const descCent = descuentos === null ? 0 : aCentavos(descuentos) ?? 0;
    total = Number(((subCent + impCent - descCent) / 100).toFixed(2));
  }

  const moneda = normalizarMoneda(elegir(raiz, 'moneda', 'currency', 'divisa')) ||
    config?.moneda_por_defecto || 'USD';

  return {
    schema_version: String(elegir(raiz, 'schema_version', 'version') ?? VERSION_ESQUEMA_ORDEN),
    orden_id: String(elegir(raiz, 'orden_id', 'id', 'po_number', 'numero', 'orden') ?? 'sin-id'),
    proveedor: {
      nombre: nombre === undefined || nombre === null ? null : String(nombre).trim(),
      identificacion_fiscal:
        idFiscal === undefined || idFiscal === null ? null : String(idFiscal).trim()
    },
    fecha_emision: fechaEmision?.iso ?? null,
    fecha_entrega_esperada: fechaEntrega?.iso ?? null,
    moneda,
    condiciones_pago: (() => {
      const v = elegir(raiz, 'condiciones_pago', 'payment_terms', 'terminos');
      return v === undefined || v === null ? null : String(v);
    })(),
    items,
    totales: { subtotal, impuestos, descuentos, total },
    totales_centavos: {
      subtotal: aCentavos(subtotal),
      impuestos: aCentavos(impuestos),
      descuentos: aCentavos(descuentos),
      total: aCentavos(total)
    },
    tolerancias: /** @type {object|undefined} */ (elegir(raiz, 'tolerancias', 'tolerances')),
    advertencias
  };
}

/**
 * @param {unknown} crudo
 * @param {number} indice
 * @param {string[]} advertencias
 * @returns {ItemOrdenNormalizado}
 */
function normalizarItemOrden(crudo, indice, advertencias) {
  const objeto =
    crudo && typeof crudo === 'object' && !Array.isArray(crudo)
      ? /** @type {Record<string, unknown>} */ (crudo)
      : {};

  const lineaCruda = elegir(objeto, 'linea', 'line', 'nro');
  const linea = Number.isFinite(Number(lineaCruda)) ? Number(lineaCruda) : indice + 1;

  const codigoCrudo = elegir(objeto, 'codigo', 'code', 'sku', 'product_code');
  const codigo = codigoCrudo === undefined || codigoCrudo === null || codigoCrudo === ''
    ? null
    : String(codigoCrudo).trim();

  const descripcionCruda = elegir(objeto, 'descripcion', 'description', 'detalle', 'concepto');
  const descripcion = descripcionCruda === undefined || descripcionCruda === null
    ? null
    : String(descripcionCruda).trim();

  const cantidad = parsearMonto(elegir(objeto, 'cantidad', 'quantity', 'qty'));
  const unidad = normalizarUnidad(elegir(objeto, 'unidad', 'unit', 'uom')) || null;
  const precio = parsearMonto(elegir(objeto, 'precio_unitario', 'unit_price', 'precio', 'price'));

  let importe = parsearMonto(
    elegir(objeto, 'importe_linea', 'importe', 'line_total', 'total', 'amount')
  );
  const cantidadMilesimas = aMilesimas(cantidad);
  const precioCentavos = aCentavos(precio);
  let importeCentavos = aCentavos(importe);

  if (importeCentavos === null && cantidadMilesimas !== null && precioCentavos !== null) {
    importeCentavos = Math.round((cantidadMilesimas * precioCentavos) / 1000);
    importe = Number((importeCentavos / 100).toFixed(2));
  }
  if (!codigo && !descripcion) {
    advertencias.push(`orden, item ${linea}: sin codigo ni descripcion`);
  }

  return {
    linea,
    codigo,
    codigo_normalizado: normalizarCodigo(codigo),
    descripcion,
    cantidad,
    cantidad_milesimas: cantidadMilesimas,
    unidad,
    precio_unitario: precio,
    precio_unitario_centavos: precioCentavos,
    importe_linea: importe,
    importe_linea_centavos: importeCentavos
  };
}

/**
 * Parsea una o varias ordenes desde JSON (objeto, array, o { ordenes: [...] }).
 * @param {unknown} entrada
 * @param {object} [config]
 * @returns {OrdenNormalizada[]}
 */
export function parsearOrdenesJson(entrada, config = {}) {
  if (Array.isArray(entrada)) return entrada.map((o) => parsearOrden(o, config));
  if (entrada && typeof entrada === 'object') {
    const lista = elegir(
      /** @type {Record<string, unknown>} */ (entrada),
      'ordenes', 'orders', 'purchase_orders', 'data'
    );
    if (Array.isArray(lista)) return lista.map((o) => parsearOrden(o, config));
    return [parsearOrden(entrada, config)];
  }
  throw new TypeError('parsearOrdenesJson: formato no reconocido');
}

/**
 * Parsea ordenes desde CSV plano (una fila por item).
 * @param {string} texto
 * @param {object} [config]
 * @returns {OrdenNormalizada[]}
 */
export function parsearOrdenesCsv(texto, config = {}) {
  const filas = parsearCsv(texto);
  /** @type {Map<string, Record<string, unknown>>} */
  const porOrden = new Map();

  for (const fila of filas) {
    const ordenId = String(
      fila.orden_id ?? fila.po ?? fila.po_number ?? fila.orden ?? fila.id ?? ''
    ).trim();
    if (!ordenId) continue;

    if (!porOrden.has(ordenId)) {
      porOrden.set(ordenId, {
        schema_version: VERSION_ESQUEMA_ORDEN,
        orden_id: ordenId,
        proveedor: {
          nombre: fila.proveedor_nombre ?? fila.proveedor ?? fila.supplier ?? null,
          identificacion_fiscal:
            fila.proveedor_id_fiscal ?? fila.proveedor_cuit ?? fila.tax_id ?? null
        },
        fecha_emision: fila.fecha_emision ?? fila.fecha ?? null,
        fecha_entrega_esperada: fila.fecha_entrega_esperada ?? fila.fecha_entrega ?? null,
        moneda: fila.moneda ?? fila.currency ?? null,
        condiciones_pago: fila.condiciones_pago ?? null,
        items: [],
        totales: {
          subtotal: fila.subtotal_total ?? null,
          impuestos: fila.impuestos_total ?? fila.iva_total ?? null,
          descuentos: fila.descuentos_total ?? null,
          total: fila.total_orden ?? fila.total_general ?? null
        }
      });
    }

    const acumulada = porOrden.get(ordenId);
    /** @type {unknown[]} */ (acumulada.items).push({
      linea: fila.linea ?? null,
      codigo: fila.codigo ?? fila.sku ?? null,
      descripcion: fila.descripcion ?? fila.detalle ?? null,
      cantidad: fila.cantidad ?? null,
      unidad: fila.unidad ?? null,
      precio_unitario: fila.precio_unitario ?? fila.precio ?? null,
      importe_linea: fila.importe_linea ?? fila.importe ?? null
    });
  }

  return [...porOrden.values()].map((o) => parsearOrden(o, config));
}
