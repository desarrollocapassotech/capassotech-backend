import { cuentaParaPortal } from './portal';

const imputacion = {
  id: 'imp-1',
  pagoId: 'pago-1',
  cargoId: 'cargo-1',
  importe: 100,
  importePago: 150000,
  monedaCargo: 'USD',
  monedaPago: 'ARS',
  documento: 'factura' as const,
  comprobanteId: 'interno-1',
  comprobanteTipo: 'FACTURA_C',
  comprobanteNumero: '00001-00000012',
  comprobanteEstado: 'EMITIDO',
  comprobanteError: 'detalle interno del Facturador',
  deshecha: false,
};

const movimiento = {
  id: 'cargo-1',
  side: 'cliente',
  tipo: 'cargo',
  origen: 'mes',
  concepto: 'Servicios Octubre 2026',
  importe: 100,
  moneda: 'USD',
  monedaOrigen: 'USD',
  fecha: '2026-10-31',
  fechaVencimiento: '2026-11-10',
  formaPago: 'Transferencia',
  referencia: 'nota interna',
  pendiente: 0,
  lineas: [
    {
      descripcion: 'Proyecto',
      cantidad: '10 h',
      importe: 100,
      referencia: 'tracker:x',
    },
  ],
  saldosAcumulados: { USD: 0 },
  imputaciones: [imputacion],
};

const cuenta = {
  advertencias: [],
  saldos: [{ moneda: 'USD', saldo: 0 }],
  movimientos: [movimiento],
};

describe('cuentaParaPortal', () => {
  it('conserva los importes y saldos tal cual, para que coincidan con administración', () => {
    const r = cuentaParaPortal(cuenta);
    expect(r.saldos).toEqual(cuenta.saldos);
    expect(r.movimientos[0].importe).toBe(100);
    expect(r.movimientos[0].pendiente).toBe(0);
    expect(r.movimientos[0].saldosAcumulados).toEqual({ USD: 0 });
  });

  it('no filtra nada interno', () => {
    const texto = JSON.stringify(cuentaParaPortal(cuenta));
    expect(texto).not.toContain('detalle interno');
    expect(texto).not.toContain('interno-1');
    expect(texto).not.toContain('nota interna');
    expect(texto).not.toContain('tracker:x');
  });

  it('solo pasa los importes de lo vigente', () => {
    const con = (extra: object) =>
      cuentaParaPortal({
        ...cuenta,
        movimientos: [
          { ...movimiento, imputaciones: [{ ...imputacion, ...extra }] },
        ],
      }).movimientos[0].imputaciones;
    expect(con({})).toEqual([
      {
        pagoId: 'pago-1',
        cargoId: 'cargo-1',
        importe: 100,
        importePago: 150000,
        monedaCargo: 'USD',
        monedaPago: 'ARS',
      },
    ]);
    expect(con({ deshecha: true })).toEqual([]);
  });

  it('muestra solo comprobantes emitidos y vigentes', () => {
    const conEstado = (extra: object) =>
      cuentaParaPortal({
        ...cuenta,
        movimientos: [
          { ...movimiento, imputaciones: [{ ...imputacion, ...extra }] },
        ],
      }).movimientos[0].comprobantes;
    expect(conEstado({})).toEqual([
      { documento: 'factura', tipo: 'FACTURA_C', numero: '00001-00000012' },
    ]);
    expect(conEstado({ comprobanteEstado: 'RECHAZADO' })).toEqual([]);
    expect(conEstado({ comprobanteEstado: 'ERROR' })).toEqual([]);
    expect(conEstado({ deshecha: true })).toEqual([]);
    expect(conEstado({ documento: null })).toEqual([]);
  });

  it('avisa si faltó calcular algo, sin contar el detalle técnico', () => {
    const r = cuentaParaPortal({
      ...cuenta,
      advertencias: ['No se pudo calcular Octubre 2026: error del servidor'],
    });
    expect(r.incompleta).toBe(true);
    expect(JSON.stringify(r)).not.toContain('error del servidor');
  });
});
