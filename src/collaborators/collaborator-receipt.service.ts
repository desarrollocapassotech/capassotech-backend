import { BadRequestException, Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  PDFDocument,
  PDFFont,
  StandardFonts,
  TextAlignment,
  rgb,
} from 'pdf-lib';
import {
  GenerateCollaboratorReceiptDto,
  GenerateCollaboratorReceiptItemDto,
} from './collaborator-receipt.dto';

// Mismo criterio que firebase-admin.provider.ts para ubicar archivos locales:
// relativo a process.cwd() (raíz del repo), no a __dirname, para que funcione
// igual en dev (ts-node) y en prod (dist/).
const TEMPLATE_PATH = join(
  process.cwd(),
  'templates',
  'template-recibo-colaborador.pdf',
);

// El template tiene 6 filas fijas (Descripción/Cantidad/Monto); estos nombres de
// campo vienen del PDF original (templates/template-recibo-colaborador.pdf) y se
// obtuvieron inspeccionando el AcroForm con pdf-lib -> no tienen un patrón
// numérico consistente porque así quedaron al exportar el diseño.
const ROW_FIELDS: Array<{
  description: string;
  quantity: string;
  amount: string;
}> = [
  { description: 'Text2', quantity: 'Text8', amount: 'Text14' },
  { description: 'Text3', quantity: 'Text9', amount: 'Text15' },
  { description: 'Text4', quantity: 'Text10', amount: 'Text16' },
  { description: 'Text5', quantity: 'Text11', amount: 'Text17' },
  { description: 'Text6', quantity: 'Text12', amount: 'Text18' },
  { description: 'Text7', quantity: 'Text13', amount: 'Text19' },
];
// Cuántos conceptos entran en los campos fijos de la página 1. No es un tope de
// negocio (el recibo admite cualquier cantidad de conceptos): a partir de este
// número, el resto se dibuja a mano en página(s) de "Anexo" (ver drawAnnexPages).
const PAGE1_ROW_COUNT = ROW_FIELDS.length;
const TOTAL_FIELD = 'Text20';

// Centro de la columna "MONTO" (obtenido de la posición del texto del header en
// el template) y línea de base para el subtítulo de moneda que va justo debajo.
const MONTO_HEADER_CENTER_X = 504;
const CURRENCY_LABEL_Y = 508;
const CURRENCY_LABEL_SIZE = 7;

// Página del anexo: mismo tamaño que la página 1 del template, para que al
// imprimir/exportar no cambie de formato de hoja.
const PAGE_WIDTH = 595.5;
const PAGE_HEIGHT = 842.25;
const PAGE_MARGIN_TOP = 792;
const PAGE_MARGIN_BOTTOM = 50;
const ANNEX_ROW_HEIGHT = 26;

// Mismas columnas que ROW_FIELDS en la página 1 (medidas inspeccionando el
// template), para que el anexo quede alineado visualmente con la página 1.
const COLUMN_X = { description: 68, quantity: 357, amount: 466 };
const COLUMN_WIDTH = { description: 281.5, quantity: 103.5, amount: 76 };

@Injectable()
export class CollaboratorReceiptService {
  async generate(dto: GenerateCollaboratorReceiptDto): Promise<Buffer> {
    if (!dto.fullName?.trim()) {
      throw new BadRequestException(
        'Falta el nombre y apellido del colaborador.',
      );
    }
    if (!dto.items?.length) {
      throw new BadRequestException(
        'El recibo necesita al menos un concepto cargado.',
      );
    }

    const templateBytes = await readFile(TEMPLATE_PATH);
    const pdfDoc = await PDFDocument.load(templateBytes);

    // El template original (exportado de Canva) trae metadata del diseño
    // ("Factura Negocio Minimalista Rosa", autor personal, etc.) que no
    // corresponde mostrar en un recibo emitido por la empresa.
    pdfDoc.setTitle(`Recibo - ${dto.fullName.trim()}`);
    pdfDoc.setAuthor('Capasso Tech');
    pdfDoc.setSubject('Recibo de pago');
    pdfDoc.setKeywords([]);
    pdfDoc.setCreator('Capasso Tech');
    pdfDoc.setProducer('Capasso Tech');

    const form = pdfDoc.getForm();

    const setText = (fieldName: string, value: string | undefined) => {
      form.getTextField(fieldName).setText(value?.trim() || '');
    };

    setText('Fecha', dto.date);
    setText('Nombre y apellido', dto.fullName);
    setText('Mes y año', dto.monthYear);
    setText('Metodo de pago', dto.paymentMethod);

    // El template solo tiene PAGE1_ROW_COUNT filas fijas; lo que exceda ese
    // número se dibuja en página(s) de anexo (ver drawAnnexPages) en vez de
    // perderse en silencio.
    const page1Items = dto.items.slice(0, PAGE1_ROW_COUNT);
    const overflowItems = dto.items.slice(PAGE1_ROW_COUNT);

    // La descripción del concepto va alineada a la izquierda (el template la
    // trae centrada por defecto, ilegible con texto largo tipo "Horas
    // trabajadas en <proyecto> ($X/h)"); cantidad/monto quedan como están.
    page1Items.forEach((item, index) => {
      const row = ROW_FIELDS[index];
      setText(row.description, item.description);
      form.getTextField(row.description).setAlignment(TextAlignment.Left);
      setText(row.quantity, item.quantity);
      setText(row.amount, item.amount);
    });

    setText(TOTAL_FIELD, dto.total);

    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Los montos ya no llevan "ARS"/"USD" en cada celda (solo el símbolo "$"),
    // así que la moneda se imprime una única vez como subtítulo bajo el header
    // "MONTO", centrada sobre esa columna.
    const currencyLabel = dto.currency?.trim().toUpperCase();
    if (currencyLabel) {
      const page = pdfDoc.getPage(0);
      const textWidth = boldFont.widthOfTextAtSize(
        currencyLabel,
        CURRENCY_LABEL_SIZE,
      );
      page.drawText(currencyLabel, {
        x: MONTO_HEADER_CENTER_X - textWidth / 2,
        y: CURRENCY_LABEL_Y,
        size: CURRENCY_LABEL_SIZE,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
    }

    // Recibo final: se aplana para que no quede editable en el PDF entregado.
    form.flatten();

    if (overflowItems.length > 0) {
      this.drawAnnexPages(pdfDoc, dto, overflowItems, {
        regular: regularFont,
        bold: boldFont,
      });
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  // Dibuja a mano el detalle que no entra en los campos fijos de la página 1
  // (concepto 7 en adelante), en tantas páginas de "Anexo" como haga falta.
  // No hay AcroForm acá: son coordenadas propias, alineadas con las mismas
  // columnas que usa la página 1 (COLUMN_X/COLUMN_WIDTH) para que se vea
  // consistente con el template, aunque no reutilice sus gráficos/bordes.
  private drawAnnexPages(
    pdfDoc: PDFDocument,
    dto: GenerateCollaboratorReceiptDto,
    overflowItems: GenerateCollaboratorReceiptItemDto[],
    fonts: { regular: PDFFont; bold: PDFFont },
  ): void {
    const { regular, bold } = fonts;
    const black = rgb(0, 0, 0);

    // Alto disponible para filas: desde la primera fila (debajo del header)
    // hasta el margen inferior, reservando espacio para el bloque de TOTAL
    // que va al pie de la última página del anexo.
    const firstRowY = PAGE_MARGIN_TOP - 45 - 6 - 20;
    const totalBlockReserve = 60;
    const rowsPerPage = Math.floor(
      (firstRowY - PAGE_MARGIN_BOTTOM - totalBlockReserve) / ANNEX_ROW_HEIGHT,
    );

    const chunks: GenerateCollaboratorReceiptItemDto[][] = [];
    for (let i = 0; i < overflowItems.length; i += rowsPerPage) {
      chunks.push(overflowItems.slice(i, i + rowsPerPage));
    }
    const totalPageCount = chunks.length + 1; // +1 por la página 1

    chunks.forEach((chunk, chunkIndex) => {
      const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      const isLastPage = chunkIndex === chunks.length - 1;

      page.drawText('Anexo — Continuación de conceptos', {
        x: COLUMN_X.description,
        y: PAGE_MARGIN_TOP,
        size: 14,
        font: bold,
        color: black,
      });
      page.drawText(
        `${dto.fullName.trim()} — ${dto.monthYear.trim()}`,
        { x: COLUMN_X.description, y: PAGE_MARGIN_TOP - 20, size: 10, font: regular, color: black },
      );

      const headerY = PAGE_MARGIN_TOP - 45;
      page.drawText('DESCRIPCIÓN', { x: COLUMN_X.description, y: headerY, size: 9, font: bold, color: black });
      page.drawText('CANTIDAD', { x: COLUMN_X.quantity, y: headerY, size: 9, font: bold, color: black });
      page.drawText('MONTO', { x: COLUMN_X.amount, y: headerY, size: 9, font: bold, color: black });

      const headerLineY = headerY - 6;
      page.drawLine({
        start: { x: COLUMN_X.description, y: headerLineY },
        end: { x: COLUMN_X.amount + COLUMN_WIDTH.amount, y: headerLineY },
        thickness: 0.75,
        color: black,
      });

      let rowY = headerLineY - 20;
      chunk.forEach((item) => {
        page.drawText(
          truncateToWidth(item.description ?? '', regular, 9, COLUMN_WIDTH.description),
          { x: COLUMN_X.description, y: rowY, size: 9, font: regular, color: black },
        );
        page.drawText(
          truncateToWidth(item.quantity ?? '', regular, 9, COLUMN_WIDTH.quantity),
          { x: COLUMN_X.quantity, y: rowY, size: 9, font: regular, color: black },
        );
        page.drawText(
          truncateToWidth(item.amount ?? '', regular, 9, COLUMN_WIDTH.amount),
          { x: COLUMN_X.amount, y: rowY, size: 9, font: regular, color: black },
        );
        rowY -= ANNEX_ROW_HEIGHT;
      });

      if (isLastPage) {
        const totalLineY = rowY + ANNEX_ROW_HEIGHT / 2;
        page.drawLine({
          start: { x: COLUMN_X.quantity, y: totalLineY },
          end: { x: COLUMN_X.amount + COLUMN_WIDTH.amount, y: totalLineY },
          thickness: 0.75,
          color: black,
        });
        page.drawText('TOTAL', { x: COLUMN_X.quantity, y: totalLineY - 16, size: 10, font: bold, color: black });
        page.drawText(dto.total?.trim() || '', {
          x: COLUMN_X.amount,
          y: totalLineY - 16,
          size: 10,
          font: bold,
          color: black,
        });
      }

      page.drawText(`Página ${chunkIndex + 2} de ${totalPageCount}`, {
        x: PAGE_WIDTH - 110,
        y: 30,
        size: 8,
        font: regular,
        color: black,
      });
    });
  }
}

// Recorta el texto (con "…" al final) si no entra en el ancho de columna
// disponible, para que una descripción larga no se superponga con la columna
// siguiente (en la página 1 esto no hace falta: son AcroForm fields de una
// sola línea que el propio visor de PDF recorta).
function truncateToWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let truncated = text;
  while (
    truncated.length > 1 &&
    font.widthOfTextAtSize(`${truncated}…`, size) > maxWidth
  ) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}
