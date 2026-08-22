/**
 * ORQUESTADOR DEL MODULO B (motor de reconciliacion).
 *
 * Flujo exacto, en este orden:
 *   1. Recibir factura y orden normalizadas.
 *   2. reiniciarContadorIds()
 *   3. reglaProveedor, reglaMoneda, reglaReferenciaOrden, reglaFechas
 *   4. emparejarItems
 *   5. reglaItems con el resultado del emparejamiento
 *   6. juntar todas las discrepancias
 *   7. derivarEstado
 *
 * Devuelve el resultado en formato INTERNO: la factura conserva los campos
 * envueltos { valor, confianza, needs_review }. El aplanado para el frontend
 * vive en otra capa (api/flatten), no aca.
 *
 * CAPA 2 (ia_semantica): fuera de scope. Los pendientes que devuelve
 * reglaProveedor se cierran como "requiere verificacion humana" por Capa 1.
 */

import { crearConfig } from '../config.js';
import {
  reiniciarContadorIds,
  derivarEstado,
  compararSeveridad,
  PESO_SEVERIDAD,
  TIPOS_DISCREPANCIA,
  CAPAS
} from '../schema/discrepancy.js';
import { parsearFacturaExtraida } from '../schema/invoice.js';
import { parsearOrden } from '../schema/order.js';
import { reglaProveedor, proveedorSinResolver } from './rules/supplier.js';
import { reglaMoneda, reglaReferenciaOrden, reglaFechas } from './rules/document.js';
import { reglaItems } from './rules/items.js';
import { emparejarItems } from './lineItems.js';
import { aCentavos, aMonto } from '../util/money.js';

export const VERSION_ESQUEMA_RESULTADO = '1.0.0';

/**
 * Tipos cuyo `delta` representa un importe en disputa (unidades monetarias).
 * PRECIO_UNITARIO_NO_COINCIDE queda afuera a proposito: su delta es por unidad,
 * no un monto total, y sumarlo distorsionaria la cifra.
 */
const TIPOS_MONETARIOS = new Set([
  TIPOS_DISCREPANCIA.TOTAL_NO_COINCIDE,
  TIPOS_DISCREPANCIA.SUBTOTAL_NO_COINCIDE,
  TIPOS_DISCREPANCIA.IMPUESTOS_NO_COINCIDEN,
  TIPOS_DISCREPANCIA.TOTAL_INCONSISTENTE,
  TIPOS_DISCREPANCIA.SUMA_LINEAS_NO_COINCIDE_SUBTOTAL,
  TIPOS_DISCREPANCIA.IMPORTE_LINEA_INCONSISTENTE,
  TIPOS_DISCREPANCIA.ITEM_NO_EN_ORDEN,
  TIPOS_DISCREPANCIA.ITEM_DUPLICADO,
  TIPOS_DISCREPANCIA.ITEM_FALTANTE_EN_FACTURA
]);

/**
 * @typedef {object} ResultadoReconciliacion
 * @property {string} schema_version
 * @property {string} generado_en ISO 8601
 * @property {string} documento_id
 * @property {string} orden_id
 * @property {string} estado
 * @property {string} moneda
 * @property {import('../schema/invoice.js').FacturaNormalizada} factura
 * @property {import('../schema/order.js').OrdenNormalizada} orden
 * @property {object} resumen
 * @property {import('../schema/discrepancy.js').Discrepancia[]} discrepancias
 * @property {object[]} items_conciliados
 * @property {object} trazabilidad
 */

/**
 * Reconcilia una factura ya normalizada contra una orden ya normalizada.
 *
 * @param {object} params
 * @param {import('../schema/invoice.js').FacturaNormalizada} params.factura
 * @param {import('../schema/order.js').OrdenNormalizada} params.orden
 * @param {object} [params.config] configuracion parcial, se mergea sobre DEFAULT_CONFIG
 * @returns {ResultadoReconciliacion}
 */
export function reconciliar({ factura, orden, config: configParcial }) {
  validarFacturaNormalizada(factura);
  validarOrdenNormalizada(orden);

  const inicio = Date.now();

  // La orden puede traer tolerancias propias que pisan la config global.
  let config = crearConfig(configParcial);
  if (orden.tolerancias) config = crearConfig({ tolerancias: orden.tolerancias }, config);

  if (config.ia?.habilitada) {
    throw new Error(
      'config.ia.habilitada = true pero la Capa 2 (comparacion semantica con QVAC) no esta ' +
        'implementada en este modulo. Dejala en false.'
    );
  }

  // --- 2) Contador de ids de discrepancia por reconciliacion ---
  reiniciarContadorIds();

  const moneda = factura.moneda?.valor || orden.moneda || config.moneda_por_defecto;
  const ctx = { factura, orden, config, moneda };

  /** @type {import('../schema/discrepancy.js').Discrepancia[]} */
  const discrepancias = [];
  /** @type {object[]} */
  const pendientes = [];
  const reglasEjecutadas = [];

  // --- 3) Reglas de cabecera, en orden ---
  for (const [nombre, regla] of [
    ['reglaProveedor', reglaProveedor],
    ['reglaMoneda', reglaMoneda],
    ['reglaReferenciaOrden', reglaReferenciaOrden],
    ['reglaFechas', reglaFechas]
  ]) {
    const salida = regla(ctx) ?? {};
    if (Array.isArray(salida.discrepancias)) discrepancias.push(...salida.discrepancias);
    if (Array.isArray(salida.pendientes)) pendientes.push(...salida.pendientes);
    reglasEjecutadas.push(nombre);
  }

  // --- 4) Emparejamiento de items (determinisitico, independiente del orden) ---
  const emparejamiento = emparejarItems(factura.items, orden.items, config.similitud.item);
  reglasEjecutadas.push('emparejarItems');

  // --- 5) Reglas de linea sobre el emparejamiento ---
  const salidaItems = reglaItems({ ...ctx, emparejamiento }) ?? {};
  if (Array.isArray(salidaItems.discrepancias)) discrepancias.push(...salidaItems.discrepancias);
  reglasEjecutadas.push('reglaItems');

  // --- 6) Pendientes de zona gris: sin Capa 2, se derivan a revision humana ---
  const pendientesSinResolver = [];
  for (const pendiente of pendientes) {
    if (pendiente.tipo !== 'proveedor') continue;
    discrepancias.push(
      proveedorSinResolver(
        pendiente,
        'La comparacion semantica local (Capa 2) esta deshabilitada en esta configuracion.'
      )
    );
    pendientesSinResolver.push({ tipo: pendiente.tipo, campo: pendiente.campo, motivo: pendiente.motivo });
  }

  // Orden de presentacion: primero lo mas grave, despues por campo.
  discrepancias.sort(
    (a, b) => compararSeveridad(b.severidad, a.severidad) || a.campo.localeCompare(b.campo)
  );

  // --- 7) Estado global ---
  const estado = derivarEstado(discrepancias);

  return {
    schema_version: VERSION_ESQUEMA_RESULTADO,
    generado_en: new Date().toISOString(),
    documento_id: factura.documento_id,
    orden_id: orden.orden_id,
    estado,
    moneda,
    factura,
    orden,
    resumen: construirResumen(discrepancias, moneda),
    discrepancias,
    items_conciliados: construirItemsConciliados(factura, orden, emparejamiento, discrepancias),
    trazabilidad: {
      capa1: {
        reglas_ejecutadas: reglasEjecutadas,
        items_factura: factura.items.length,
        items_orden: orden.items.length,
        items_emparejados: emparejamiento.asignaciones.length,
        candidatos_ambiguos: emparejamiento.candidatos_ambiguos.length
      },
      capa2: {
        habilitada: false,
        motivo: 'fuera de scope: la comparacion semantica con QVAC no esta implementada',
        consultas: 0,
        pendientes_sin_resolver: pendientesSinResolver
      },
      advertencias_parseo: [...factura.advertencias, ...orden.advertencias],
      duracion_ms: Date.now() - inicio
    }
  };
}

/**
 * Igual que `reconciliar`, pero acepta los payloads crudos (JSON de Persona A y
 * JSON/objeto de orden de compra) y los normaliza antes.
 *
 * @param {object} params
 * @param {unknown} params.facturaExtraida payload crudo del modulo de extraccion
 * @param {unknown} params.orden payload crudo de la orden de compra
 * @param {object} [params.config]
 * @returns {ResultadoReconciliacion}
 */
export function reconciliarCrudo({ facturaExtraida, orden, config: configParcial }) {
  const config = crearConfig(configParcial);
  return reconciliar({
    factura: parsearFacturaExtraida(facturaExtraida, config),
    orden: parsearOrden(orden, config),
    config: configParcial
  });
}

/**
 * @param {import('../schema/discrepancy.js').Discrepancia[]} discrepancias
 * @param {string} moneda
 */
function construirResumen(discrepancias, moneda) {
  const porSeveridad = { critica: 0, alta: 0, media: 0, baja: 0, informativa: 0 };
  let disputaCentavos = 0;
  let requiereRevision = false;
  let severidadMaxima = null;

  for (const d of discrepancias) {
    if (porSeveridad[d.severidad] !== undefined) porSeveridad[d.severidad] += 1;
    if (d.requiere_revision_manual) requiereRevision = true;
    if (severidadMaxima === null || compararSeveridad(d.severidad, severidadMaxima) > 0) {
      severidadMaxima = d.severidad;
    }
    if (TIPOS_MONETARIOS.has(d.tipo) && typeof d.delta === 'number') {
      disputaCentavos += Math.abs(aCentavos(d.delta) ?? 0);
    }
  }

  return {
    total_discrepancias: discrepancias.length,
    por_severidad: porSeveridad,
    severidad_maxima: severidadMaxima,
    monto_en_disputa: aMonto(disputaCentavos) ?? 0,
    moneda,
    requiere_revision_manual: requiereRevision,
    discrepancias_por_capa: {
      capa1_reglas: discrepancias.filter((d) => d.capa === CAPAS.DETERMINISTICA).length,
      capa1_sin_resolver: discrepancias.filter((d) => d.capa === CAPAS.SIN_RESOLVER).length,
      capa2_ia: discrepancias.filter((d) => d.capa === CAPAS.SEMANTICA).length
    }
  };
}

/**
 * Traza que linea de factura quedo contra que linea de orden, y si tuvo problemas.
 *
 * @param {import('../schema/invoice.js').FacturaNormalizada} factura
 * @param {import('../schema/order.js').OrdenNormalizada} orden
 * @param {import('./lineItems.js').ResultadoEmparejamiento} emparejamiento
 * @param {import('../schema/discrepancy.js').Discrepancia[]} discrepancias
 */
function construirItemsConciliados(factura, orden, emparejamiento, discrepancias) {
  return [...emparejamiento.asignaciones]
    .sort((a, b) => a.linea_factura - b.linea_factura)
    .map((a) => {
      const prefijo = `items[${a.linea_factura}]`;
      const propias = discrepancias.filter(
        (d) => d.campo === prefijo || d.campo.startsWith(`${prefijo}.`)
      );
      let severidadMaxima = null;
      for (const d of propias) {
        if (severidadMaxima === null || PESO_SEVERIDAD[d.severidad] > PESO_SEVERIDAD[severidadMaxima]) {
          severidadMaxima = d.severidad;
        }
      }
      return {
        linea_factura: a.linea_factura,
        linea_orden: a.linea_orden,
        descripcion_factura: factura.items[a.indice_factura].descripcion?.valor ?? null,
        descripcion_orden: orden.items[a.indice_orden].descripcion ?? null,
        metodo_match: a.metodo,
        score_match: a.score,
        codigos_discrepan: a.codigos_discrepan,
        estado: propias.length ? 'con_discrepancias' : 'ok',
        severidad_maxima: severidadMaxima,
        discrepancias: propias.map((d) => d.id)
      };
    });
}

/**
 * @param {unknown} factura
 */
function validarFacturaNormalizada(factura) {
  if (!factura || typeof factura !== 'object') {
    throw new TypeError('reconciliar: falta la factura normalizada');
  }
  const f = /** @type {any} */ (factura);
  if (!f.proveedor?.nombre || typeof f.proveedor.nombre !== 'object' || !('presente' in f.proveedor.nombre)) {
    throw new TypeError(
      'reconciliar: la factura no esta normalizada (usa parsearFacturaExtraida o reconciliarCrudo)'
    );
  }
  if (!Array.isArray(f.items)) {
    throw new TypeError('reconciliar: la factura normalizada no tiene items[]');
  }
}

/**
 * @param {unknown} orden
 */
function validarOrdenNormalizada(orden) {
  if (!orden || typeof orden !== 'object') {
    throw new TypeError('reconciliar: falta la orden normalizada');
  }
  const o = /** @type {any} */ (orden);
  if (!Array.isArray(o.items) || !o.totales_centavos) {
    throw new TypeError(
      'reconciliar: la orden no esta normalizada (usa parsearOrden / parsearOrdenesCsv)'
    );
  }
}
