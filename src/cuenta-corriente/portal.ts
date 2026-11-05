// Lo que ve un cliente de su cuenta corriente en el portal. Los saldos son los mismos que ve
// administración; acá se elige campo por campo qué sale, para que nada interno (errores del
// Facturador, ids, comprobantes sin emitir) llegue al cliente por agregarlo a la cuenta.

interface ImputacionCuenta {
  pagoId: string;
  cargoId: string;
  importe: number;
  importePago: number;
  monedaCargo?: string;
  monedaPago?: string;
  documento: 'factura' | 'recibo' | null;
  comprobanteTipo: string | null;
  comprobanteNumero: string | null;
  comprobanteEstado: string | null;
  deshecha: boolean;
}

interface MovimientoCuenta {
  id: string;
  tipo: string;
  concepto: string;
  importe: number;
  moneda: string;
  fecha: string;
  fechaVencimiento: string | null;
  pendiente: number;
  lineas: Array<{ descripcion: string; cantidad: string; importe: number }>;
  monedaOrigen: string | null;
  saldosAcumulados: Record<string, number>;
  imputaciones: ImputacionCuenta[];
}

interface Cuenta {
  advertencias: string[];
  saldos: Array<{ moneda: string; saldo: number }>;
  movimientos: MovimientoCuenta[];
}

export function cuentaParaPortal(c: Cuenta) {
  return {
    // Sin el detalle técnico: alcanza con saber que algún mes no se pudo calcular.
    incompleta: c.advertencias.length > 0,
    saldos: c.saldos,
    movimientos: c.movimientos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      concepto: m.concepto,
      importe: m.importe,
      moneda: m.moneda,
      fecha: m.fecha,
      fechaVencimiento: m.fechaVencimiento,
      pendiente: m.pendiente,
      saldosAcumulados: m.saldosAcumulados,
      lineas: m.lineas.map((l) => ({
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        importe: l.importe,
      })),
      monedaLineas: m.monedaOrigen ?? m.moneda,
      // Solo lo emitido y vigente: un comprobante rechazado o deshecho no es del cliente.
      comprobantes: m.imputaciones
        .filter(
          (i) =>
            i.documento && !i.deshecha && i.comprobanteEstado === 'EMITIDO',
        )
        .map((i) => ({
          documento: i.documento,
          tipo: i.comprobanteTipo,
          numero: i.comprobanteNumero,
        })),
      // Solo los importes vigentes: con eso lo cancelado se ve igual que en administración.
      imputaciones: m.imputaciones
        .filter((i) => !i.deshecha)
        .map((i) => ({
          pagoId: i.pagoId,
          cargoId: i.cargoId,
          importe: i.importe,
          importePago: i.importePago,
          monedaCargo: i.monedaCargo,
          monedaPago: i.monedaPago,
        })),
    })),
  };
}
