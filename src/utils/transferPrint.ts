import type { BusinessSettings, StockTransfer } from '../types';
import { formatCurrency } from './formatters';

function escapePdfText(input: string): string {
  // Strip non-ASCII characters safely for standard Type1 Helvetica encoding and escape PDF literals
  const ascii = String(input || '').replace(/[^\x20-\x7E]/g, ' ');
  return ascii
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function truncate(str: string, maxLen: number): string {
  const s = String(str || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(1, maxLen - 3))}...`;
}

function wrapText(str: string, maxChars: number): string[] {
  const words = String(str || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current += ` ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Generates a clean multi-page A4 PDF voucher directly in memory and downloads it
 * as `stock_transfer_<transferNumber>.pdf` (works offline in Desktop Electron & Web).
 */
export async function printStockTransferVoucher(
  transfer: StockTransfer,
  settings: BusinessSettings
): Promise<boolean> {
  try {
    const pageWidth = 595.28; // A4 width in pt
    const pageHeight = 841.89; // A4 height in pt
    const marginLeft = 40;
    const marginRight = 40;
    const contentWidth = pageWidth - marginLeft - marginRight;

    const pages: string[][] = [];
    let currentOps: string[] = [];
    let y = pageHeight - 48;

    const pushNewPage = () => {
      if (currentOps.length > 0) {
        pages.push(currentOps);
      }
      currentOps = [];
      y = pageHeight - 48;
    };

    const drawText = (
      text: string,
      x: number,
      yPos: number,
      size: number = 10,
      bold: boolean = false,
      rgb: [number, number, number] = [0.1, 0.14, 0.2]
    ) => {
      const font = bold ? '/F2' : '/F1';
      currentOps.push(
        `BT ${font} ${size} Tf ${rgb[0]} ${rgb[1]} ${rgb[2]} rg 1 0 0 1 ${x.toFixed(2)} ${yPos.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`
      );
    };

    const drawRightText = (
      text: string,
      rightX: number,
      yPos: number,
      size: number = 10,
      bold: boolean = false,
      rgb: [number, number, number] = [0.1, 0.14, 0.2]
    ) => {
      // Approximate Helvetica glyph width (~0.52 * fontSize per char)
      const approxWidth = escapePdfText(text).length * size * (bold ? 0.55 : 0.52);
      drawText(text, Math.max(marginLeft, rightX - approxWidth), yPos, size, bold, rgb);
    };

    const drawLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      lineWidth: number = 0.75,
      rgb: [number, number, number] = [0.8, 0.84, 0.9]
    ) => {
      currentOps.push(
        `q ${lineWidth} w ${rgb[0]} ${rgb[1]} ${rgb[2]} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`
      );
    };

    const drawRect = (
      x: number,
      yPos: number,
      w: number,
      h: number,
      fillRgb: [number, number, number]
    ) => {
      currentOps.push(
        `q ${fillRgb[0]} ${fillRgb[1]} ${fillRgb[2]} rg ${x.toFixed(2)} ${yPos.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`
      );
    };

    // Header banner
    drawRect(marginLeft, y - 48, contentWidth, 58, [0.06, 0.09, 0.16]);
    drawText(
      truncate(settings.businessName || 'Gmeck Company Limited', 48),
      marginLeft + 14,
      y - 12,
      14,
      true,
      [1, 1, 1]
    );
    drawText(
      truncate(settings.tagline || 'Stock Transfer Voucher', 64),
      marginLeft + 14,
      y - 27,
      9,
      false,
      [0.75, 0.82, 0.94]
    );
    drawText(
      truncate(
        [settings.address, settings.phone].filter(Boolean).join('  |  '),
        70
      ),
      marginLeft + 14,
      y - 40,
      8,
      false,
      [0.65, 0.72, 0.84]
    );
    drawRightText(
      'STOCK TRANSFER VOUCHER',
      pageWidth - marginRight - 14,
      y - 14,
      11,
      true,
      [0.38, 0.65, 0.98]
    );
    drawRightText(
      transfer.transferNumber,
      pageWidth - marginRight - 14,
      y - 30,
      10,
      true,
      [1, 1, 1]
    );
    drawRightText(
      transfer.status === 'COMPLETED' ? 'STATUS: COMPLETED' : 'STATUS: NOT COMPLETE',
      pageWidth - marginRight - 14,
      y - 42,
      8,
      true,
      transfer.status === 'COMPLETED' ? [0.2, 0.83, 0.6] : [0.98, 0.75, 0.14]
    );

    y -= 68;

    // Metadata & From / To block
    drawText(`Transfer Date: ${transfer.transferDate || transfer.createdAt.slice(0, 10)}`, marginLeft, y, 9.5, true);
    drawRightText(
      `Recorded By: ${truncate(transfer.createdByName || 'Admin', 28)}`,
      pageWidth - marginRight,
      y,
      9.5,
      false,
      [0.3, 0.35, 0.45]
    );
    y -= 14;

    const colW = (contentWidth - 12) / 2;
    drawRect(marginLeft, y - 44, colW, 46, [0.95, 0.97, 0.99]);
    drawRect(marginLeft + colW + 12, y - 44, colW, 46, [0.94, 0.99, 0.96]);

    drawText('LOCATION FROM', marginLeft + 10, y - 12, 8, true, [0.15, 0.39, 0.92]);
    drawText(truncate(transfer.sourceName, 36), marginLeft + 10, y - 25, 10, true);
    drawText(
      truncate(
        [transfer.sourceShopName, transfer.sourceLocation].filter(Boolean).join(' - '),
        42
      ),
      marginLeft + 10,
      y - 37,
      8.5,
      false,
      [0.35, 0.4, 0.5]
    );

    const rightBoxX = marginLeft + colW + 12;
    drawText('LOCATION TO', rightBoxX + 10, y - 12, 8, true, [0.02, 0.59, 0.41]);
    drawText(truncate(transfer.destName, 36), rightBoxX + 10, y - 25, 10, true);
    drawText(
      truncate(
        [transfer.destShopName, transfer.destLocation].filter(Boolean).join(' - '),
        42
      ),
      rightBoxX + 10,
      y - 37,
      8.5,
      false,
      [0.35, 0.4, 0.5]
    );

    y -= 60;

    if (transfer.notice) {
      const noticeLines = wrapText(`Notice: ${transfer.notice}`, 95);
      for (const line of noticeLines) {
        drawText(line, marginLeft, y, 9, false, [0.57, 0.25, 0.05]);
        y -= 13;
      }
      y -= 4;
    }

    const drawTableHeader = () => {
      drawRect(marginLeft, y - 16, contentWidth, 20, [0.12, 0.16, 0.24]);
      drawText('#', marginLeft + 8, y - 10, 8.5, true, [1, 1, 1]);
      drawText('PRODUCT NAME / SKU', marginLeft + 28, y - 10, 8.5, true, [1, 1, 1]);
      drawRightText('QTY', marginLeft + 345, y - 10, 8.5, true, [1, 1, 1]);
      drawRightText('UNIT PRICE', marginLeft + 430, y - 10, 8.5, true, [1, 1, 1]);
      drawRightText('SUBTOTAL', pageWidth - marginRight - 8, y - 10, 8.5, true, [1, 1, 1]);
      y -= 24;
    };

    drawTableHeader();

    const items = transfer.items || [];
    items.forEach((item, idx) => {
      if (y < 95) {
        pushNewPage();
        drawTableHeader();
      }
      const label = `${item.productName}${item.variation ? ` (${item.variation})` : ''}`;
      drawText(String(idx + 1), marginLeft + 8, y, 9, false, [0.4, 0.45, 0.55]);
      drawText(truncate(label, 44), marginLeft + 28, y, 9.5, true);
      if (item.sku) {
        drawText(`SKU: ${truncate(item.sku, 28)}`, marginLeft + 28, y - 11, 7.5, false, [0.45, 0.5, 0.6]);
      }
      drawRightText(
        `${Number(item.quantity || 0).toLocaleString()} ${item.unit || 'pcs'}`,
        marginLeft + 345,
        y,
        9
      );
      drawRightText(
        formatCurrency(item.unitPrice || 0, settings.currencySymbol),
        marginLeft + 430,
        y,
        9
      );
      drawRightText(
        formatCurrency(item.subtotal || 0, settings.currencySymbol),
        pageWidth - marginRight - 8,
        y,
        9.5,
        true
      );
      y -= 20;
      drawLine(marginLeft, y + 4, pageWidth - marginRight, y + 4, 0.5, [0.9, 0.92, 0.95]);
      y -= 6;
    });

    if (y < 120) {
      pushNewPage();
    }

    y -= 6;
    drawRect(marginLeft, y - 54, contentWidth, 58, [0.96, 0.97, 0.99]);
    drawText(
      `Total Products: ${items.length} item(s)  |  Total Units: ${Number(transfer.totalUnits || 0).toLocaleString()}`,
      marginLeft + 12,
      y - 15,
      9.5,
      true
    );
    drawRightText(
      `Products Total: ${formatCurrency(transfer.totalAmount || 0, settings.currencySymbol)}`,
      pageWidth - marginRight - 12,
      y - 15,
      9.5,
      true
    );
    drawRightText(
      `Shipping Charges: ${formatCurrency(transfer.shippingCharges || 0, settings.currencySymbol)}`,
      pageWidth - marginRight - 12,
      y - 30,
      9.5,
      false,
      [0.35, 0.4, 0.5]
    );
    const grandTotal =
      Number(transfer.totalAmount || 0) + Number(transfer.shippingCharges || 0);
    drawRightText(
      `GRAND TOTAL: ${formatCurrency(grandTotal, settings.currencySymbol)}`,
      pageWidth - marginRight - 12,
      y - 47,
      11,
      true,
      [0.02, 0.52, 0.35]
    );

    if (currentOps.length > 0) {
      pages.push(currentOps);
    }

    // Build minimal valid PDF 1.4 document
    const objects: string[] = [];
    const addObject = (body: string): number => {
      objects.push(body);
      return objects.length;
    };

    const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pagesPlaceholderId = addObject(''); // updated after page objects are created

    const pageObjIds: number[] = [];
    for (const ops of pages) {
      const streamData = ops.join('\n');
      const contentId = addObject(
        `<< /Length ${streamData.length} >>\nstream\n${streamData}\nendstream`
      );
      const pageId = addObject(
        `<< /Type /Page /Parent ${pagesPlaceholderId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
      pageObjIds.push(pageId);
    }

    objects[pagesPlaceholderId - 1] = `<< /Type /Pages /Kids [${pageObjIds
      .map(id => `${id} 0 R`)
      .join(' ')}] /Count ${pageObjIds.length} >>`;

    const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesPlaceholderId} 0 R >>`);

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    objects.forEach((objBody, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${objBody}\nendobj\n`;
    });

    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= objects.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) {
      bytes[i] = pdf.charCodeAt(i) & 0xff;
    }

    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stock_transfer_${transfer.transferNumber || transfer.id}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);

    return true;
  } catch (err) {
    console.error('[transferPrint] Failed to generate transfer PDF:', err);
    return false;
  }
}
