import {
  detectarComprobante,
  normalizarNumeroComprobante,
  tipoDeArchivo,
} from './leer-comprobante';

describe('normalizarNumeroComprobante', () => {
  it('completa con ceros', () => {
    expect(normalizarNumeroComprobante('1-16519')).toBe('00001-00016519');
    expect(normalizarNumeroComprobante(' 00001 - 00016519 ')).toBe(
      '00001-00016519',
    );
  });
  it('rechaza lo que no es un número de comprobante', () => {
    for (const v of ['', '16519', '0-5', '1-0', 'abc', '123456-1', 5, null]) {
      expect(normalizarNumeroComprobante(v)).toBeNull();
    }
  });
});

describe('detectarComprobante', () => {
  it('lee el formato del Facturador', () => {
    expect(
      detectarComprobante(
        'CCOD. 011\nFACTURA\nN° 00001-00016519\nPeríodo facturado: 01/10/2026 al 31/10/2026',
      ),
    ).toEqual({ numero: '00001-00016519', tipo: 'FACTURA_C' });
  });
  it('lee el formato de ARCA, en cualquiera de sus órdenes', () => {
    expect(
      detectarComprobante(
        'FACTURA C COD. 011 Punto de Venta: 00003 Comp. Nro: 00000045',
      ).numero,
    ).toBe('00003-00000045');
    expect(
      detectarComprobante('Punto de Venta: Comp. Nro: 00003 00000045').numero,
    ).toBe('00003-00000045');
  });
  it('original, duplicado y triplicado son un solo comprobante', () => {
    const copia = 'COD. 006 Punto de Venta: 00002 Comp. Nro: 00000010 ';
    expect(detectarComprobante(copia.repeat(3))).toEqual({
      numero: '00002-00000010',
      tipo: 'FACTURA_B',
    });
  });
  it('no confunde un CUIT ni un CAE con el número', () => {
    expect(
      detectarComprobante('CUIT: 30-66834690-8 CAE N°: 76123456789012').numero,
    ).toBeNull();
  });
  it('con dos números distintos no adivina', () => {
    expect(
      detectarComprobante('N° 00001-00000001 asociada a N° 00001-00000002')
        .numero,
    ).toBeNull();
  });
  it('la etiqueta manda sobre otro número suelto', () => {
    expect(
      detectarComprobante('Remito 0001-00000099 N° 00001-00000100').numero,
    ).toBe('00001-00000100');
  });
  it('sin texto no detecta nada', () => {
    expect(detectarComprobante('')).toEqual({ numero: null, tipo: null });
  });
});

describe('tipoDeArchivo', () => {
  it('reconoce por el contenido', () => {
    expect(tipoDeArchivo(Buffer.from('%PDF-1.7'))?.extension).toBe('pdf');
    expect(tipoDeArchivo(Buffer.from('89504e470d0a', 'hex'))?.extension).toBe(
      'png',
    );
    expect(tipoDeArchivo(Buffer.from('ffd8ffe0', 'hex'))?.extension).toBe(
      'jpg',
    );
  });
  it('rechaza lo demás, aunque se llame .pdf', () => {
    expect(tipoDeArchivo(Buffer.from('<html>'))).toBeNull();
  });
});
