/**
 * InvoiceGuard - Modulo B (motor de reconciliacion). API publica.
 *
 * Esto es lo que consumen el servidor HTTP, el CLI y cualquier otro modulo.
 * Todo corre 100% local y sin dependencias externas: la Capa 1 es logica pura.
 */

// --- Orquestador ---
export { reconciliar, reconciliarCrudo, VERSION_ESQUEMA_RESULTADO } from './matching/engine.js';

// --- Normalizadores de entrada ---
export { parsearFacturaExtraida, VERSION_ESQUEMA_FACTURA } from './schema/invoice.js';
export {
  parsearOrden,
  parsearOrdenesJson,
  parsearOrdenesCsv,
  VERSION_ESQUEMA_ORDEN
} from './schema/order.js';

// --- Contrato de salida ---
export {
  TIPOS_DISCREPANCIA,
  SEVERIDADES,
  PESO_SEVERIDAD,
  CAPAS,
  ESTADOS_RECONCILIACION,
  crearDiscrepancia,
  derivarEstado,
  compararSeveridad,
  severidadPorMagnitud,
  reiniciarContadorIds
} from './schema/discrepancy.js';

// --- Configuracion ---
export { DEFAULT_CONFIG, crearConfig } from './config.js';

// --- Piezas reutilizables (utiles para el modulo de extraccion y para tests) ---
export { leerCampo, campoDerivado, serializarCampo, esDudoso } from './schema/fields.js';
export { emparejarItems, scoreIdentidad, confirmarAsignacion } from './matching/lineItems.js';
export {
  parsearMonto,
  aCentavos,
  aMonto,
  aMilesimas,
  aCantidad,
  compararCentavos,
  formatearMonto,
  formatearCantidad,
  detectarPatronOcr
} from './util/money.js';
export { parsearFecha, diferenciaDias, sumarDias, formatearFecha } from './util/dates.js';
export {
  normalizarTexto,
  normalizarNombreEmpresa,
  normalizarIdFiscal,
  normalizarCodigo,
  normalizarUnidad,
  normalizarMoneda,
  similitudProveedor,
  similitudDescripcion
} from './util/text.js';
export { parsearCsv, parsearCsvMatriz } from './util/csv.js';
