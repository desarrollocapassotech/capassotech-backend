// Comprobante emitido afuera que se adjunta al imputar un cobro: qué archivo es y qué número y tipo
// tiene. Ante la duda no se adivina: el número es obligatorio y queda para cargarlo a mano.

const CODIGOS_ARCA: Record<string, string> = {
  '001': 'FACTURA_A',
  '006': 'FACTURA_B',
  '011': 'FACTURA_C',
  '051': 'FACTURA_M',
};

const TIPOS_VALIDOS = new Set(Object.values(CODIGOS_ARCA));

export const tipoComprobanteValido = (v: unknown): v is string =>
  typeof v === 'string' && TIPOS_VALIDOS.has(v);

/** "1-16519" → "00001-00016519". `null`: no es un número de comprobante. */
export function normalizarNumeroComprobante(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const m = /^\s*(\d{1,5})\s*-\s*(\d{1,8})\s*$/.exec(valor);
  if (!m || Number(m[1]) === 0 || Number(m[2]) === 0) return null;
  return `${m[1].padStart(5, '0')}-${m[2].padStart(8, '0')}`;
}

/** El único número distinto entre los encontrados; con varios, no se elige ninguno. */
function unico(pares: Array<[string, string]>): string | null {
  const numeros = new Set(
    pares.flatMap(([pv, nro]) => {
      const n = normalizarNumeroComprobante(`${pv}-${nro}`);
      return n ? [n] : [];
    }),
  );
  return numeros.size === 1 ? [...numeros][0] : null;
}

const pares = (texto: string, regex: RegExp) =>
  [...texto.matchAll(regex)].map((m): [string, string] => [m[1], m[2]]);

export function detectarComprobante(texto: string): {
  numero: string | null;
  tipo: string | null;
} {
  // Del más seguro al menos seguro. Las facturas de ARCA traen original, duplicado y triplicado:
  // el mismo número repetido es uno solo.
  const busquedas = [
    // ARCA, con cada dato junto a su etiqueta.
    /Punto\s+de\s+Venta:?\s*(\d{1,5})\s*Comp\.?\s*Nro:?\s*(\d{1,8})/gi,
    // ARCA, con las etiquetas juntas y los valores después (según cómo se lea el PDF).
    /Punto\s+de\s+Venta:?\s*Comp\.?\s*Nro:?\s*(\d{1,5})\s+(\d{1,8})/gi,
    /(?:N[°º]|Nro\.?|N[uú]mero:?)\s*(\d{4,5})\s*-\s*(\d{8})\b/gi,
    /\b(\d{4,5})-(\d{8})\b/g,
  ];
  let numero: string | null = null;
  for (const regex of busquedas) {
    const encontrados = pares(texto, regex);
    if (encontrados.length) {
      numero = unico(encontrados);
      break;
    }
  }

  const codigos = new Set(
    [...texto.matchAll(/COD\.?\s*(\d{3})\b/gi)].flatMap((m) =>
      CODIGOS_ARCA[m[1]] ? [CODIGOS_ARCA[m[1]]] : [],
    ),
  );
  const letras = new Set(
    [...texto.matchAll(/FACTURA\s+([ABCM])\b/gi)].map(
      (m) => `FACTURA_${m[1].toUpperCase()}`,
    ),
  );
  const tipos = codigos.size ? codigos : letras;
  return { numero, tipo: tipos.size === 1 ? [...tipos][0] : null };
}

/** Por el contenido, no por el nombre ni por lo que dice el navegador. */
export function tipoDeArchivo(
  b: Buffer,
): { contentType: string; extension: 'pdf' | 'png' | 'jpg' } | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  if (b.subarray(0, 4).toString('hex') === '89504e47') {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (b.subarray(0, 3).toString('hex') === 'ffd8ff') {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  return null;
}

/** Texto del PDF. Uno escaneado o dañado da vacío: el número se carga a mano. */
export async function textoDePdf(buffer: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return '';
  }
}
