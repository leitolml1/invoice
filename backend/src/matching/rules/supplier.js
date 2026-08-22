/**
 * Regla determinisitica de proveedor.
 *
 * Prioridad de senales, de mas fuerte a mas debil:
 *  1. Identificacion fiscal (CUIT/RUC/NIF...). Si ambas estan y coinciden, es el
 *     mismo proveedor y no se consulta nada mas. Si difieren, es discrepancia
 *     critica: dos IDs fiscales distintos no son la misma empresa.
 *  2. Nombre normalizado exacto (sin acentos, sin sufijos societarios).
 *  3. Similitud de tokens con soporte de abreviaturas por prefijo.
 *
 * La IA solo se propone cuando la similitud cae en la zona gris configurada.
 */

import { similitudProveedor, normalizarIdFiscal } from '../../util/text.js';
import { crearDiscrepancia, TIPOS_DISCREPANCIA, SEVERIDADES, CAPAS } from '../../schema/discrepancy.js';

/**
 * @param {object} ctx
 * @param {import('../../schema/invoice.js').FacturaNormalizada} ctx.factura
 * @param {import('../../schema/order.js').OrdenNormalizada} ctx.orden
 * @param {object} ctx.config
 * @returns {{ discrepancias: import('../../schema/discrepancy.js').Discrepancia[], pendientes: object[] }}
 */
export function reglaProveedor({ factura, orden, config }) {
  const discrepancias = [];
  const pendientes = [];

  const nombreFactura = factura.proveedor.nombre;
  const nombreOrden = orden.proveedor.nombre;

  if (!nombreFactura.presente) {
    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.CAMPO_ILEGIBLE,
        campo: 'proveedor.nombre',
        valor_factura: null,
        valor_ordenado: nombreOrden,
        explicacion_legible:
          'No se pudo leer el nombre del proveedor en la factura, asi que no hay forma de validar ' +
          `que corresponda a "${nombreOrden ?? 's/d'}". Hay que verificarlo contra el documento original.`,
        severidad: SEVERIDADES.ALTA,
        sugerencia: 'Reprocesar el documento con mejor calidad de imagen o cargar el proveedor a mano.',
        contexto: { texto_crudo: nombreFactura.texto_crudo }
      })
    );
    return { discrepancias, pendientes };
  }

  const idFacturaNorm = normalizarIdFiscal(factura.proveedor.identificacion_fiscal.valor);
  const idOrdenNorm = normalizarIdFiscal(orden.proveedor.identificacion_fiscal);
  const sim = similitudProveedor(nombreFactura.valor, nombreOrden);

  // --- 1) Identificacion fiscal: senal decisiva ---
  if (idFacturaNorm && idOrdenNorm) {
    if (idFacturaNorm === idOrdenNorm) {
      // Mismo ID fiscal. Si el nombre difiere mucho, lo informamos pero no bloqueamos.
      if (sim.score < config.similitud.proveedor.coincide) {
        discrepancias.push(
          crearDiscrepancia({
            tipo: TIPOS_DISCREPANCIA.PROVEEDOR_VARIANTE_NOMBRE,
            campo: 'proveedor.nombre',
            valor_factura: nombreFactura.valor,
            valor_ordenado: nombreOrden,
            explicacion_legible:
              `El nombre del proveedor se escribe distinto en la factura ("${nombreFactura.valor}") ` +
              `y en la orden ("${nombreOrden}"), pero la identificacion fiscal es la misma ` +
              `(${factura.proveedor.identificacion_fiscal.valor}), por lo que se trata de la misma empresa.`,
            severidad: SEVERIDADES.INFORMATIVA,
            requiere_revision_manual: false,
            confianza: 1,
            sugerencia: 'Normalizar el nombre del proveedor en el maestro para futuras cargas.',
            contexto: { similitud_nombre: sim.score, resuelto_por: 'identificacion_fiscal' }
          })
        );
      }
      return { discrepancias, pendientes };
    }

    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.IDENTIFICACION_FISCAL_NO_COINCIDE,
        campo: 'proveedor.identificacion_fiscal',
        valor_factura: factura.proveedor.identificacion_fiscal.valor,
        valor_ordenado: orden.proveedor.identificacion_fiscal,
        explicacion_legible:
          `La identificacion fiscal de la factura (${factura.proveedor.identificacion_fiscal.valor}) ` +
          `no coincide con la de la orden de compra (${orden.proveedor.identificacion_fiscal}). ` +
          'Son entidades distintas: la factura no deberia pagarse contra esta orden.',
        severidad: SEVERIDADES.CRITICA,
        sugerencia: 'Verificar si la factura corresponde a otra orden o si hay un intento de fraude.',
        contexto: { similitud_nombre: sim.score }
      })
    );
    return { discrepancias, pendientes };
  }

  // --- 2) y 3) Solo tenemos nombres ---
  if (sim.score >= config.similitud.proveedor.coincide) {
    return { discrepancias, pendientes };
  }

  if (sim.score < config.similitud.proveedor.distinto) {
    discrepancias.push(
      crearDiscrepancia({
        tipo: TIPOS_DISCREPANCIA.PROVEEDOR_DISTINTO,
        campo: 'proveedor.nombre',
        valor_factura: nombreFactura.valor,
        valor_ordenado: nombreOrden,
        explicacion_legible:
          `El proveedor de la factura ("${nombreFactura.valor}") no se parece al de la orden de ` +
          `compra ("${nombreOrden}"). Similitud calculada: ${(sim.score * 100).toFixed(0)}%.`,
        severidad: SEVERIDADES.CRITICA,
        confianza: 1 - sim.score,
        sugerencia: 'Confirmar a que orden de compra corresponde realmente esta factura.',
        contexto: {
          similitud_nombre: sim.score,
          normalizado_factura: sim.normalizadoA,
          normalizado_orden: sim.normalizadoB,
          metodo: sim.metodo
        }
      })
    );
    return { discrepancias, pendientes };
  }

  // Zona gris: aca, y solo aca, tiene sentido preguntarle a la IA.
  pendientes.push({
    tipo: 'proveedor',
    campo: 'proveedor.nombre',
    texto_factura: nombreFactura.valor,
    texto_orden: nombreOrden,
    similitud_capa1: sim.score,
    motivo:
      `similitud ${(sim.score * 100).toFixed(0)}% cae entre los umbrales ` +
      `${config.similitud.proveedor.distinto} y ${config.similitud.proveedor.coincide}`,
    contexto: {
      normalizado_factura: sim.normalizadoA,
      normalizado_orden: sim.normalizadoB,
      metodo_capa1: sim.metodo
    }
  });

  return { discrepancias, pendientes };
}

/**
 * Construye la discrepancia cuando un pendiente de proveedor no se pudo resolver
 * con IA (deshabilitada, sin modelo, o veredicto indeterminado).
 *
 * @param {object} pendiente
 * @param {string} motivoNoResuelto
 * @returns {import('../../schema/discrepancy.js').Discrepancia}
 */
export function proveedorSinResolver(pendiente, motivoNoResuelto) {
  return crearDiscrepancia({
    tipo: TIPOS_DISCREPANCIA.PROVEEDOR_REQUIERE_VERIFICACION,
    campo: pendiente.campo,
    valor_factura: pendiente.texto_factura,
    valor_ordenado: pendiente.texto_orden,
    explicacion_legible:
      `No se puede determinar automaticamente si "${pendiente.texto_factura}" y ` +
      `"${pendiente.texto_orden}" son el mismo proveedor (similitud ` +
      `${(pendiente.similitud_capa1 * 100).toFixed(0)}%, zona gris). ${motivoNoResuelto} ` +
      'Requiere confirmacion humana.',
    severidad: SEVERIDADES.MEDIA,
    requiere_revision_manual: true,
    capa: CAPAS.SIN_RESOLVER,
    confianza: 0.5,
    sugerencia: 'Confirmar la identidad del proveedor y, si corresponde, registrar el alias.',
    contexto: { ...pendiente.contexto, similitud_capa1: pendiente.similitud_capa1 }
  });
}

/**
 * Construye la discrepancia a partir del veredicto de la Capa 2.
 *
 * @param {object} pendiente
 * @param {{ decision: 'equivalentes'|'distintos'|'indeterminado', confianza: number, metodo: string, explicacion: string }} veredicto
 * @returns {import('../../schema/discrepancy.js').Discrepancia|null}
 */
export function proveedorResueltoPorIa(pendiente, veredicto) {
  if (veredicto.decision === 'equivalentes') {
    return crearDiscrepancia({
      tipo: TIPOS_DISCREPANCIA.PROVEEDOR_VARIANTE_NOMBRE,
      campo: pendiente.campo,
      valor_factura: pendiente.texto_factura,
      valor_ordenado: pendiente.texto_orden,
      explicacion_legible:
        `El nombre del proveedor difiere entre factura ("${pendiente.texto_factura}") y orden ` +
        `("${pendiente.texto_orden}"). La comparacion semantica local los considera la misma ` +
        `empresa (${veredicto.explicacion}). Se marca para confirmacion porque la decision no ` +
        'proviene de una regla exacta.',
      severidad: SEVERIDADES.BAJA,
      requiere_revision_manual: true,
      capa: CAPAS.SEMANTICA,
      confianza: veredicto.confianza,
      sugerencia: 'Confirmar el alias y darlo de alta en el maestro de proveedores.',
      contexto: {
        ...pendiente.contexto,
        similitud_capa1: pendiente.similitud_capa1,
        metodo_capa2: veredicto.metodo
      }
    });
  }

  if (veredicto.decision === 'distintos') {
    return crearDiscrepancia({
      tipo: TIPOS_DISCREPANCIA.PROVEEDOR_DISTINTO,
      campo: pendiente.campo,
      valor_factura: pendiente.texto_factura,
      valor_ordenado: pendiente.texto_orden,
      explicacion_legible:
        `El proveedor de la factura ("${pendiente.texto_factura}") no corresponde al de la orden ` +
        `("${pendiente.texto_orden}"). Las reglas exactas no pudieron decidir y la comparacion ` +
        `semantica local los considera empresas distintas (${veredicto.explicacion}).`,
      severidad: SEVERIDADES.ALTA,
      requiere_revision_manual: true,
      capa: CAPAS.SEMANTICA,
      confianza: veredicto.confianza,
      sugerencia: 'Verificar contra que orden de compra se emitio esta factura.',
      contexto: {
        ...pendiente.contexto,
        similitud_capa1: pendiente.similitud_capa1,
        metodo_capa2: veredicto.metodo
      }
    });
  }

  return proveedorSinResolver(
    pendiente,
    `La comparacion semantica local tampoco pudo decidir (${veredicto.explicacion}).`
  );
}
