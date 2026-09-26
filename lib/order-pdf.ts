import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { type OrderRecord } from './orders';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const safe = (value: string) =>
  value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = safe(text).split(/\s+/).filter(Boolean),
    lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export async function orderPdf(order: OrderRecord) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 48,
    contentWidth = pageSize[0] - margin * 2;
  let page!: PDFPage,
    y = 0;
  const addPage = () => {
    page = document.addPage(pageSize);
    y = pageSize[1] - margin;
    page.drawText('QR MENU EC', {
      x: margin,
      y,
      size: 9,
      font: bold,
      color: rgb(0.26, 0.38, 0.19),
    });
    page.drawText(`Pedido ${order.number}`, {
      x:
        pageSize[0] -
        margin -
        bold.widthOfTextAtSize(`Pedido ${order.number}`, 9),
      y,
      size: 9,
      font: bold,
      color: rgb(0.35, 0.39, 0.35),
    });
    y -= 25;
  };
  const ensure = (height: number) => {
    if (y - height < margin + 30) addPage();
  };
  const line = (
    text: string,
    options: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      gap?: number;
    } = {},
  ) => {
    const usedFont = options.font || regular,
      size = options.size || 10,
      indent = options.indent || 0;
    const lines = wrap(text, usedFont, size, contentWidth - indent);
    ensure(lines.length * (size + 4) + 6);
    for (const value of lines) {
      page.drawText(value, {
        x: margin + indent,
        y,
        size,
        font: usedFont,
        color: options.color || rgb(0.12, 0.15, 0.12),
      });
      y -= size + 4;
    }
    y -= options.gap ?? 3;
  };

  addPage();
  line(order.restaurantName, {
    font: bold,
    size: 24,
    color: rgb(0.12, 0.23, 0.12),
    gap: 10,
  });
  line('PEDIDO CONFIRMADO', {
    font: bold,
    size: 11,
    color: rgb(0.29, 0.47, 0.18),
  });
  line(order.number, { font: bold, size: 18, gap: 5 });
  line(
    new Date(order.createdAt).toLocaleString('es-EC', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Guayaquil',
    }),
    { size: 10, color: rgb(0.38, 0.42, 0.38), gap: 10 },
  );
  if (order.alias)
    line(`Cliente: ${order.alias}`, { font: bold, size: 11, gap: 10 });
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageSize[0] - margin, y },
    thickness: 1,
    color: rgb(0.86, 0.89, 0.84),
  });
  y -= 18;

  for (const item of order.lines) {
    ensure(65 + item.options.length * 18);
    line(`${item.quantity} x ${item.dishName}`, {
      font: bold,
      size: 12,
      gap: 2,
    });
    for (const option of item.options)
      line(
        `${option.groupName}: ${option.optionName}${option.priceDeltaCents ? ` (+${usd(option.priceDeltaCents)})` : ''}`,
        { size: 9, color: rgb(0.35, 0.39, 0.35), indent: 16, gap: 0 },
      );
    if (item.note)
      line(`Nota: ${item.note}`, {
        size: 9,
        color: rgb(0.45, 0.31, 0.08),
        indent: 16,
        gap: 0,
      });
    const amount = usd(item.totalCents);
    page.drawText(amount, {
      x: pageSize[0] - margin - bold.widthOfTextAtSize(amount, 11),
      y: y + 14,
      size: 11,
      font: bold,
      color: rgb(0.12, 0.15, 0.12),
    });
    y -= 8;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageSize[0] - margin, y },
      thickness: 0.5,
      color: rgb(0.9, 0.91, 0.89),
    });
    y -= 14;
  }
  ensure(80);
  const total = `TOTAL ${usd(order.totalCents)}`;
  page.drawRectangle({
    x: margin,
    y: y - 35,
    width: contentWidth,
    height: 48,
    color: rgb(0.09, 0.13, 0.1),
  });
  page.drawText(total, {
    x: pageSize[0] - margin - bold.widthOfTextAtSize(total, 17) - 18,
    y: y - 19,
    size: 17,
    font: bold,
    color: rgb(1, 1, 1),
  });
  y -= 62;
  line(
    'Muéstrale este pedido al mesero. Este documento no es una factura ni confirma el pago.',
    { size: 9, color: rgb(0.38, 0.42, 0.38) },
  );

  const pages = document.getPages();
  pages.forEach((current, index) => {
    const footer = `Página ${index + 1} de ${pages.length}`;
    current.drawText(footer, {
      x: pageSize[0] - margin - regular.widthOfTextAtSize(footer, 8),
      y: 25,
      size: 8,
      font: regular,
      color: rgb(0.5, 0.52, 0.5),
    });
  });
  document.setTitle(`Pedido ${order.number}`);
  document.setAuthor('QR Menu EC');
  return document.save();
}
