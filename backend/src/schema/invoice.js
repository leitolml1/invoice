/**
 * ENTRADA: Factura extraida por Persona A (OCR + IA via @qvac/sdk).
 *
 * Contrato canonico (ver contracts/factura-extraida.schema.json):
 *
 * {
 *   "schema_version": "1.0.0",
 *   "documento_id": "fact-0001",
 *   "tipo_documento": "factura",
 *   "origen": { "archivo": "f001.pdf", "paginas": 1, "motor": "qvac", "modelo": "..." },
 *   "proveedor": {
 *     "nombre": { "valor": "ACME SA", "confianza": 0.97, "needs_review": false },
 *     "identificacion_fiscal": { "valor": "30-71234567-9", "confianza": 0.91, "needs_review": false }
 *   },
 *   "numero_factura": { "valor": "A-0001-00012345", "confianza": 0.95, "needs_review": false },
 *   "fecha_emision": { "valor": "2026-07-15", "confianza": 0.93, "needs_review": false },
 *   "moneda": { "valor": "USD", "confianza": 0.99, "needs_review": false },
 *   "orden_compra_referencia": { "valor": "PO-2026-0001", "confianza": 0.88, "needs_review": false },
 *   "items": [ { "linea": 1, "codigo": {...}, "descripcion": {...}, "cantidad": {...},
 *               "unidad": {...}, "precio_unitario": {...}, "importe_linea": {...} } ],
 *   "totales": { "subtotal": {...}, "impuestos": {...}, "descuentos": {...}, "total": {...} },
 *   "needs_review": false,
 *   "confianza_global": 0.94
 * }
 *
 * Cualquier campo envuelto puede venir como escalar pelado; ver schema/fields.js.
 */

import { leerCampo, elegir, campoDerivado } from './fields.js';
import { parsearMonto, aCentavos, aMilesimas } from '../util/money.js';
import { parsearFecha } from '../util/dates.js';
import { normalizarMoneda, normalizarUnidad } from '../util/text.js';

export const VERSION_ESQUEMA_FACTURA = '1.0.0';

/**
 * @typedef {import('./fields.js').Campo<any>} Campo
 */

/**
 * @typedef {object} ItemFacturaNormalizado
 * @property {number} linea
 * @property {Campo} codigo
 * @property {Campo} descripcion
 * @property {Campo} cantidad valor en unidades (number)
 * @property {Campo} unidad
 * @property {Campo} precio_unitario valor en unidades monetarias (number)
 * @property {Campo} importe_linea
 * @property {number|null} cantidad_milesimas
 * @property {number|null} precio_unitario_centavos
 * @property {number|null} importe_linea_centavos
 */

/**
 * @typedef {object} FacturaNormalizada
 * @property {string} schema_version
 * @property {string} documento_id
 * @property {string} tipo_documento
 * @property {Record<string, unknown>} origen
 * @property {{ nombre: Campo, identificacion_fiscal: Campo }} proveedor
 * @property {Campo} numero_factura
 * @property {Campo} fecha_emision
 * @property {Campo} moneda
 * @property {Campo} orden_compra_referencia
 * @property {ItemFacturaNormalizado[]} items
 * @property {{ subtotal: Campo, impuestos: Campo, descuentos: Campo, total: Campo }} totales
 * @property {boolean} needs_review
 * @property {number} confianza_global
 * @property {string[]} advertencias problemas encontrados al parsear
 * @property {unknown} crudo payload original de Persona A
 */

/**
 * Normaliza la factura extraida a la forma interna del motor.
 *
 * @param {unknown} entrada payload de Persona A (objeto ya parseado de JSON)
 * @param {object} [config] configuracion (se usa confianza.por_defecto_si_ausente y formato_fecha_preferido)
 * @returns {FacturaNormalizada}
 */
export function parsearFacturaExtraida(entrada, config = {}) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new TypeError('parsearFacturaExtraida: se esperaba un objeto con la factura extraida');
  }
  const raiz = /** @type {Record<string, unknown>} */ (entrada);
  const advertencias = [];
  const confianzaPorDefecto = config?.confianza?.por_defecto_si_ausente ?? 1;
  const preferirFecha = config?.formato_fecha_preferido ?? 'dmy';

  const proveedorCrudo = elegir(raiz, 'proveedor', 'supplier', 'vendor', 'emisor') ?? {};
  const proveedorObj =
    typeof proveedorCrudo === 'object' && proveedorCrudo !== null
      ? /** @type {Record<string, unknown>} */ (proveedorCrudo)
      : { nombre: proveedorCrudo };

  const nombre = leerCampo(
    elegir(proveedorObj, 'nombre', 'name', 'razon_social', 'razonSocial'),
    { transformar: (v) => String(v).trim(), confianzaPorDefecto }
  );
  const idFiscal = leerCampo(
    elegir(
      proveedorObj,
      'identificacion_fiscal', 'tax_id', 'taxId', 'cuit', 'ruc', 'nif', 'vat', 'ein', 'rfc'
    ),
    { transformar: (v) => String(v).trim(), confianzaPorDefecto }
  );

  const numeroFactura = leerCampo(
    elegir(raiz, 'numero_factura', 'invoice_number', 'invoiceNumber', 'numero', 'nro_factura'),
    { transformar: (v) => String(v).trim(), confianzaPorDefecto }
  );

  const fechaEmision = leerCampo(
    elegir(raiz, 'fecha_emision', 'fecha', 'date', 'issue_date', 'issueDate', 'invoice_date'),
    {
      confianzaPorDefecto,
      transformar: (v) => {
        const f = parsearFecha(v, { preferir: preferirFecha });
        if (!f) {
          advertencias.push(`fecha_emision ilegible: ${JSON.stringify(v)}`);
          return null;
        }
        return f.iso;
      }
    }
  );
  // Recuperamos metadata de ambiguedad para las reglas de fecha.
  {
    const f = parsearFecha(fechaEmision.valor_crudo, { preferir: preferirFecha });
    fechaEmision.extra = {
      ...(fechaEmision.extra ?? {}),
      ambigua: Boolean(f?.ambigua),
      iso_alternativo: f?.iso_alternativo ?? null,
      formato: f?.formato ?? null
    };
  }

  const moneda = leerCampo(
    elegir(raiz, 'moneda', 'currency', 'divisa'),
    { transformar: (v) => normalizarMoneda(v) || null, confianzaPorDefecto }
  );

  const ordenReferencia = leerCampo(
    elegir(
      raiz,
      'orden_compra_referencia', 'orden_compra', 'purchase_order', 'purchaseOrder',
      'po_number', 'poNumber', 'oc', 'orden_id'
    ),
    { transformar: (v) => String(v).trim(), confianzaPorDefecto }
  );

  const itemsCrudos = elegir(raiz, 'items', 'line_items', 'lineItems', 'lineas', 'detalle', 'renglones');
  const items = Array.isArray(itemsCrudos)
    ? itemsCrudos.map((it, indice) => parsearItem(it, indice, { confianzaPorDefecto, advertencias }))
    : [];
  if (!Array.isArray(itemsCrudos)) {
    advertencias.push('la factura no trae un array de items');
  }

  const totalesCrudos = elegir(raiz, 'totales', 'totals', 'importes') ?? raiz;
  const totalesObj = /** @type {Record<string, unknown>} */ (totalesCrudos);

  const subtotal = leerCampoMonetario(
    elegir(totalesObj, 'subtotal', 'sub_total', 'neto', 'net', 'importe_neto'),
    confianzaPorDefecto
  );
  const impuestos = leerCampoMonetario(
    elegir(totalesObj, 'impuestos', 'tax', 'taxes', 'iva', 'vat', 'impuesto'),
    confianzaPorDefecto
  );
  const descuentos = leerCampoMonetario(
    elegir(totalesObj, 'descuentos', 'descuento', 'discount', 'discounts'),
    confianzaPorDefecto
  );
  const total = leerCampoMonetario(
    elegir(totalesObj, 'total', 'total_general', 'grand_total', 'importe_total', 'amount_total'),
    confianzaPorDefecto
  );

  if (!total.presente) advertencias.push('no se pudo leer el total de la factura');

  const campos = [nombre, idFiscal, numeroFactura, fechaEmision, moneda, total];
  for (const item of items) {
    campos.push(item.descripcion, item.cantidad, item.precio_unitario, item.importe_linea);
  }
  const presentes = campos.filter((c) => c.presente);
  const confianzaCalculada = presentes.length
    ? Number((presentes.reduce((acc, c) => acc + c.confianza, 0) / presentes.length).toFixed(4))
    : 0;

  const confianzaGlobalDeclarada = elegir(raiz, 'confianza_global', 'confidence', 'global_confidence');
  const needsReviewDeclarado = elegir(raiz, 'needs_review', 'needsReview', 'requiere_revision');

  return {
    schema_version: String(elegir(raiz, 'schema_version', 'version') ?? VERSION_ESQUEMA_FACTURA),
    documento_id: String(
      elegir(raiz, 'documento_id', 'id', 'document_id', 'documentId') ??
        numeroFactura.valor ??
        'sin-id'
    ),
    tipo_documento: String(elegir(raiz, 'tipo_documento', 'document_type', 'tipo') ?? 'factura'),
    origen: /** @type {Record<string, unknown>} */ (
      elegir(raiz, 'origen', 'source', 'metadata') ?? {}
    ),
    proveedor: { nombre, identificacion_fiscal: idFiscal },
    numero_factura: numeroFactura,
    fecha_emision: fechaEmision,
    moneda,
    orden_compra_referencia: ordenReferencia,
    items,
    totales: { subtotal, impuestos, descuentos, total },
    needs_review:
      typeof needsReviewDeclarado === 'boolean'
        ? needsReviewDeclarado
        : campos.some((c) => c.needs_review),
    confianza_global:
      typeof confianzaGlobalDeclarada === 'number'
        ? (confianzaGlobalDeclarada > 1 ? confianzaGlobalDeclarada / 100 : confianzaGlobalDeclarada)
        : confianzaCalculada,
    advertencias,
    crudo: entrada
  };
}

/**
 * @param {unknown} crudo
 * @param {number} confianzaPorDefecto
 * @returns {Campo}
 */
function leerCampoMonetario(crudo, confianzaPorDefecto) {
  return leerCampo(crudo, {
    confianzaPorDefecto,
    transformar: (v) => {
      const n = parsearMonto(v);
      return n === null ? null : n;
    }
  });
}

/**
 * @param {unknown} crudo
 * @param {number} indice
 * @param {{confianzaPorDefecto: number, advertencias: string[]}} ctx
 * @returns {ItemFacturaNormalizado}
 */
function parsearItem(crudo, indice, ctx) {
  const objeto =
    crudo && typeof crudo === 'object' && !Array.isArray(crudo)
      ? /** @type {Record<string, unknown>} */ (crudo)
      : {};

  const lineaCruda = elegir(objeto, 'linea', 'line', 'nro', 'numero', 'index');
  const linea = Number.isFinite(Number(lineaCruda)) ? Number(lineaCruda) : indice + 1;

  const codigo = leerCampo(
    elegir(objeto, 'codigo', 'code', 'sku', 'codigo_producto', 'product_code', 'item_code'),
    { transformar: (v) => String(v).trim(), confianzaPorDefecto: ctx.confianzaPorDefecto }
  );
  const descripcion = leerCampo(
    elegir(objeto, 'descripcion', 'description', 'detalle', 'concepto', 'producto', 'name'),
    { transformar: (v) => String(v).trim(), confianzaPorDefecto: ctx.confianzaPorDefecto }
  );
  const cantidad = leerCampo(
    elegir(objeto, 'cantidad', 'quantity', 'qty', 'cant'),
    { transformar: (v) => parsearMonto(v), confianzaPorDefecto: ctx.confianzaPorDefecto }
  );
  const unidad = leerCampo(
    elegir(objeto, 'unidad', 'unit', 'uom', 'unidad_medida'),
    { transformar: (v) => normalizarUnidad(v) || null, confianzaPorDefecto: ctx.confianzaPorDefecto }
  );
  const precioUnitario = leerCampo(
    elegir(objeto, 'precio_unitario', 'unit_price', 'unitPrice', 'precio', 'price'),
    { transformar: (v) => parsearMonto(v), confianzaPorDefecto: ctx.confianzaPorDefecto }
  );
  const importeLinea = leerCampo(
    elegir(objeto, 'importe_linea', 'importe', 'line_total', 'lineTotal', 'total', 'amount', 'subtotal'),
    { transformar: (v) => parsearMonto(v), confianzaPorDefecto: ctx.confianzaPorDefecto }
  );

  if (!descripcion.presente && !codigo.presente) {
    ctx.advertencias.push(`item ${linea}: sin descripcion ni codigo, no se puede identificar`);
  }

  const cantidadMilesimas = cantidad.presente ? aMilesimas(cantidad.valor) : null;
  const precioCentavos = precioUnitario.presente ? aCentavos(precioUnitario.valor) : null;
  let importeCentavos = importeLinea.presente ? aCentavos(importeLinea.valor) : null;

  // Si falta el importe de linea pero tenemos cantidad y precio, lo derivamos.
  let importeFinal = importeLinea;
  if (importeCentavos === null && cantidadMilesimas !== null && precioCentavos !== null) {
    importeCentavos = Math.round((cantidadMilesimas * precioCentavos) / 1000);
    importeFinal = campoDerivado(
      Number((importeCentavos / 100).toFixed(2)),
      Math.min(cantidad.confianza, precioUnitario.confianza)
    );
  }

  return {
    linea,
    codigo,
    descripcion,
    cantidad,
    unidad,
    precio_unitario: precioUnitario,
    importe_linea: importeFinal,
    cantidad_milesimas: cantidadMilesimas,
    precio_unitario_centavos: precioCentavos,
    importe_linea_centavos: importeCentavos
  };
}
