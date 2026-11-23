import type { BusinessSettings, InventoryMovement } from '../types';
import { formatCurrency, formatDateTime } from './formatters';
import { downloadPdfBlob, PdfPrintResult, printPdfBlob } from './pdfExport';

function escapePdfText(input: string): string {
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

function buildMovementsReportBlob(
  movements: InventoryMovement[],
  settings: BusinessSettings,
  meta: {
    periodLabel: string;
    typeLabel: string;
    shopLabel: string;
  }
): { blob: Blob; fileName: string } {
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const marginLeft = 36;
    const marginRight = 36;
    const contentWidth = pageWidth - marginLeft - marginRight;

    const pages: string[][] = [];
    let currentOps: string[] = [];
    let y = pageHeight - 42;

    const pushNewPage = () => {
      if (currentOps.length > 0) pages.push(currentOps);
      currentOps = [];
      y = pageHeight - 42;
    };

    const drawText = (
      text: string,
      x: number,
      yPos: number,
      size: number = 9,
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
      size: number = 9,
      bold: boolean = false,
      rgb: [number, number, number] = [0.1, 0.14, 0.2]
    ) => {
      const approxWidth = escapePdfText(text).length * size * (bold ? 0.54 : 0.5);
      drawText(text, Math.max(marginLeft, rightX - approxWidth), yPos, size, bold, rgb);
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

    const drawLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      lineWidth: number = 0.5,
      rgb: [number, number, number] = [0.85, 0.88, 0.92]
    ) => {
      currentOps.push(
        `q ${lineWidth} w ${rgb[0]} ${rgb[1]} ${rgb[2]} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`
      );
    };

    const cur = settings.currencySymbol || 'TSh';
    const totalIn = movements.reduce((s, m) => (m.changeQty > 0 ? s + m.changeQty : s), 0);
    const totalOut = movements.reduce((s, m) => (m.changeQty < 0 ? s + Math.abs(m.changeQty) : s), 0);
    const totalCostImpact = movements.reduce((s, m) => s + Number(m.costValue || 0), 0);

    // Header Banner
    drawRect(marginLeft, y - 48, contentWidth, 58, [0.06, 0.09, 0.16]);
    drawText(
      truncate(settings.businessName || 'Gmeck Company Limited', 44),
      marginLeft + 14,
      y - 12,
      13.5,
      true,
      [1, 1, 1]
    );
    drawText(
      truncate(`${meta.shopLabel} | ${meta.typeLabel}`, 58),
      marginLeft + 14,
      y - 26,
      8.5,
      false,
      [0.75, 0.82, 0.94]
    );
    drawText(
      truncate(`Period: ${meta.periodLabel} | Generated: ${new Date().toLocaleString()}`, 68),
      marginLeft + 14,
      y - 39,
      7.5,
      false,
      [0.65, 0.72, 0.84]
    );
    drawRightText(
      'STOCK MOVEMENTS REPORT',
      pageWidth - marginRight - 14,
      y - 14,
      10.5,
      true,
      [0.38, 0.65, 0.98]
    );
    drawRightText(
      `${movements.length} record(s)`,
      pageWidth - marginRight - 14,
      y - 29,
      8.5,
      true,
      [1, 1, 1]
    );
    y -= 66;

    // Summary Bar
    drawRect(marginLeft, y - 22, contentWidth, 26, [0.95, 0.97, 0.99]);
    drawText(`Records: ${movements.length}`, marginLeft + 10, y - 13, 8.5, true);
    drawText(`Added (+): +${totalIn}`, marginLeft + 130, y - 13, 8.5, true, [0.02, 0.52, 0.35]);
    drawText(`Deducted (-): -${totalOut}`, marginLeft + 255, y - 13, 8.5, true, [0.75, 0.15, 0.22]);
    drawRightText(
      `Cost Impact: ${formatCurrency(totalCostImpact, cur)}`,
      pageWidth - marginRight - 10,
      y - 13,
      8.5,
      true,
      [0.45, 0.25, 0.7]
    );
    y -= 34;

    const drawHeader = () => {
      drawRect(marginLeft, y - 15, contentWidth, 18, [0.12, 0.16, 0.24]);
      const yH = y - 9;
      drawText('DATE / SHOP', marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
      drawText('PRODUCT & REASON', marginLeft + 115, yH, 7.5, true, [1, 1, 1]);
      drawText('TYPE', marginLeft + 305, yH, 7.5, true, [1, 1, 1]);
      drawRightText('QTY (B->A)', marginLeft + 440, yH, 7.5, true, [1, 1, 1]);
      drawRightText('COST VALUE', pageWidth - marginRight - 6, yH, 7.5, true, [1, 1, 1]);
      y -= 22;
    };

    drawHeader();

    movements.forEach(m => {
      const neededHeight = 32;
      if (y - neededHeight < 48) {
        pushNewPage();
        drawHeader();
      }

      const isPos = m.changeQty > 0;
      const isLoss = ['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(m.type);

      drawText(truncate(formatDateTime(m.createdAt), 20), marginLeft + 6, y, 7.5, false);
      drawText(
        truncate(`${m.shopName || 'Shop'} | ${m.userName}`, 22),
        marginLeft + 6,
        y - 10,
        7,
        false,
        [0.45, 0.5, 0.6]
      );

      drawText(truncate(m.productName, 34), marginLeft + 115, y, 8, true);
      drawText(
        truncate(m.reason || '-', 38),
        marginLeft + 115,
        y - 10,
        7,
        false,
        [0.4, 0.45, 0.55]
      );

      drawText(
        truncate(m.type, 13),
        marginLeft + 305,
        y,
        7.5,
        true,
        isLoss ? [0.75, 0.15, 0.22] : [0.2, 0.25, 0.35]
      );

      drawRightText(
        `${isPos ? `+${m.changeQty}` : m.changeQty} (${m.previousQty}->${m.newQty})`,
        marginLeft + 440,
        y,
        8,
        true,
        isPos ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
      );

      drawRightText(
        m.costValue !== undefined ? formatCurrency(m.costValue, cur) : '-',
        pageWidth - marginRight - 6,
        y,
        8,
        isLoss,
        isLoss ? [0.75, 0.15, 0.22] : [0.2, 0.25, 0.35]
      );

      y -= 20;
      drawLine(marginLeft, y + 3, pageWidth - marginRight, y + 3, 0.4, [0.9, 0.92, 0.95]);
      y -= 6;
    });

    if (currentOps.length > 0) {
      pages.push(currentOps);
    }

    const objects: string[] = [];
    const addObject = (body: string): number => {
      objects.push(body);
      return objects.length;
    };

    const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const pagesPlaceholderId = addObject('');

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

    const cleanShop = (meta.shopLabel || 'all_shops').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const fileName = `stock_movements_${cleanShop}_${new Date().toISOString().slice(0, 10)}.pdf`;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    return { blob, fileName };
}

export async function downloadMovementsReportPdf(
  movements: InventoryMovement[],
  settings: BusinessSettings,
  meta: {
    periodLabel: string;
    typeLabel: string;
    shopLabel: string;
  }
): Promise<boolean> {
  try {
    const { blob, fileName } = buildMovementsReportBlob(movements, settings, meta);
    return downloadPdfBlob(blob, fileName);
  } catch (err) {
    console.error('[movementsPrint] downloadMovementsReportPdf failed:', err);
    return false;
  }
}

export async function printMovementsReportPdf(
  movements: InventoryMovement[],
  settings: BusinessSettings,
  meta: {
    periodLabel: string;
    typeLabel: string;
    shopLabel: string;
  }
): Promise<PdfPrintResult> {
  try {
    const { blob, fileName } = buildMovementsReportBlob(movements, settings, meta);
    return printPdfBlob(blob, fileName);
  } catch (err: any) {
    console.error('[movementsPrint] printMovementsReportPdf failed:', err);
    return {
      ok: false,
      error: err?.message || 'Could not print stock movements PDF.',
    };
  }
}
