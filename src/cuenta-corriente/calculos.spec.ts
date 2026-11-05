import {
  calcularImputacion,
  calcularSaldos,
  convertir,
  lineasDelComprobante,
  mesesCerrados,
  netoDeTotal,
  resolverAjuste,
} from './calculos';

describe('convertir', () => {
  it('no toca el importe si es la misma moneda, aunque no haya TC', () => {
    expect(convertir(100, 'ARS', 'ARS', null)).toBe(100);
  });
  it('multiplica de USD a ARS y divide de ARS a USD', () => {
    expect(convertir(10, 'USD', 'ARS', 1500)).toBe(15000);
    expect(convertir(15000, 'ARS', 'USD', 1500)).toBe(10);
  });
  it('falla sin TC si hay que convertir', () => {
    expect(() => convertir(10, 'USD', 'ARS', null)).toThrow();
  });
});

describe('calcularImputacion', () => {
  const base = {
    pendienteCargo: 1000,
    disponiblePago: 400,
    monedaCargo: 'USD' as const,
    monedaPago: 'USD' as const,
  };

  it('pago parcial: imputa solo lo disponible', () => {
    expect(calcularImputacion(base)).toEqual({
      importeCargo: 400,
      importePago: 400,
    });
  });
  it('un importe mayor no es error: se topea con lo pendiente', () => {
    expect(
      calcularImputacion({
        ...base,
        disponiblePago: 5000,
        importe: 2000,
      }),
    ).toEqual({ importeCargo: 1000, importePago: 1000 });
  });
  it('cobro en pesos contra deuda en dólares, al TC indicado', () => {
    expect(
      calcularImputacion({
        ...base,
        monedaPago: 'ARS',
        disponiblePago: 600000,
        tc: 1500,
      }),
    ).toEqual({ importeCargo: 400, importePago: 600000 });
  });
  it('no deja un centavo suelto al consumir todo el pago en otra moneda', () => {
    const r = calcularImputacion({
      ...base,
      monedaPago: 'ARS',
      disponiblePago: 100000,
      tc: 1333.33,
    });
    expect(r?.importePago).toBe(100000);
  });
  it('sin nada para imputar devuelve null', () => {
    expect(calcularImputacion({ ...base, disponiblePago: 0 })).toBeNull();
  });
});

describe('calcularSaldos', () => {
  const mov = (
    id: string,
    tipo: 'cargo' | 'pago' | 'credito',
    importe: number,
    moneda: 'USD' | 'ARS',
    fecha: string,
  ) => ({ id, tipo, importe, moneda, fecha, creado: 0 });

  it('acumula por moneda sin mezclarlas', () => {
    const { finales } = calcularSaldos(
      [
        mov('a', 'cargo', 100, 'USD', '2026-10-31'),
        mov('b', 'cargo', 5000, 'ARS', '2026-10-31'),
        mov('c', 'pago', 40, 'USD', '2026-11-02'),
      ],
      [],
    );
    expect(finales).toEqual({ USD: 60, ARS: 5000 });
  });
  it('un pago en pesos imputado a una deuda en dólares cancela las dos monedas', () => {
    const { finales } = calcularSaldos(
      [
        mov('cargo', 'cargo', 100, 'USD', '2026-10-31'),
        mov('pago', 'pago', 150000, 'ARS', '2026-11-02'),
      ],
      [
        {
          pagoId: 'pago',
          importeCargo: 100,
          importePago: 150000,
          monedaCargo: 'USD',
          monedaPago: 'ARS',
        },
      ],
    );
    expect(finales).toEqual({ USD: 0, ARS: 0 });
  });
  it('el crédito resta', () => {
    const { finales } = calcularSaldos(
      [
        mov('a', 'cargo', 100, 'USD', '2026-10-31'),
        mov('b', 'credito', 30, 'USD', '2026-11-01'),
      ],
      [],
    );
    expect(finales.USD).toBe(70);
  });
});

describe('lineasDelComprobante', () => {
  const lineas = [
    { descripcion: 'A', cantidad: '10 h', importe: 100 },
    { descripcion: 'B', cantidad: '20 h', importe: 200 },
  ];

  it('un pago parcial va en una sola línea', () => {
    expect(lineasDelComprobante(lineas, 50, false, 'Pago a cuenta')).toEqual([
      { descripcion: 'Pago a cuenta', importe: 50 },
    ]);
  });
  it('cancelar todo conserva el detalle y la suma da justo el total', () => {
    const r = lineasDelComprobante(lineas, 1000.01, true, 'x');
    expect(r.map((l) => l.descripcion)).toEqual(['A (10 h)', 'B (20 h)']);
    expect(r.reduce((t, l) => t + l.importe, 0)).toBeCloseTo(1000.01, 2);
  });
});

describe('netoDeTotal', () => {
  it('saca el IVA solo si corresponde', () => {
    expect(netoDeTotal(121, true)).toBe(100);
    expect(netoDeTotal(121, false)).toBe(121);
  });
});

describe('mesesCerrados', () => {
  it('no incluye el mes en curso y cruza el año', () => {
    expect(mesesCerrados('2025-11', '2026-02-15')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });
  it('arrancar en el mes actual no genera nada', () => {
    expect(mesesCerrados('2026-11', '2026-11-05')).toEqual([]);
  });
});

describe('resolverAjuste', () => {
  it('sin diferencia no hace nada', () => {
    expect(resolverAjuste(100, 100, [])).toBeNull();
  });
  it('crea un ajuste por la diferencia, con signo', () => {
    expect(resolverAjuste(120, 100, [])).toEqual({
      accion: 'crear',
      importe: 20,
    });
    expect(resolverAjuste(80, 100, [])).toEqual({
      accion: 'crear',
      importe: -20,
    });
  });
  it('corrige el ajuste libre en vez de apilar otro', () => {
    expect(
      resolverAjuste(130, 100, [{ id: 'x', importe: 20, imputado: false }]),
    ).toEqual({ accion: 'actualizar', id: 'x', importe: 30 });
  });
  it('borra el ajuste libre si la diferencia desaparece', () => {
    expect(
      resolverAjuste(100, 100, [{ id: 'x', importe: 20, imputado: false }]),
    ).toEqual({ accion: 'borrar', id: 'x' });
  });
  it('no toca un ajuste ya imputado', () => {
    expect(
      resolverAjuste(130, 100, [{ id: 'x', importe: 20, imputado: true }]),
    ).toEqual({ accion: 'crear', importe: 10 });
  });
});
