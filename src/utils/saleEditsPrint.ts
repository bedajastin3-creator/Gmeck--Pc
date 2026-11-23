import { db } from '../db/storage';
import { BusinessSettings, Sale, SaleEditRequest } from '../types';
import { formatCurrency, formatDateTime } from './formatters';

export interface SaleEditChangeItem {
  kind: 'added' | 'removed' | 'modified' | 'total';
  label: string;
  detail: string;
}

export interface FormattedSaleEditDetails {
  receiptNumber: string;
  shopName: string;
  sellerName: string;
  productNames: string[];
  changes: SaleEditChangeItem[];
}

export function formatSaleEditDetails(
  req: SaleEditRequest,
  sale: Sale | undefined,
  currencySymbol: string
): FormattedSaleEditDetails {
  const cur = currencySymbol || 'TSh';
  const origItems = req.originalValues?.items || [];
  const newItems = req.newValues?.items || [];

  const shopId =
    sale?.shopId ||
    origItems[0]?.shopId ||
    newItems[0]?.shopId ||
    '';

  const resolvedShopName =
    sale?.shopName ||
    (shopId ? db.getShops().find(s => s.id === shopId)?.name : undefined) ||
    'Shop';

  const receiptNumber =
    sale?.receiptNumber || (req.saleId ? req.saleId.slice(0, 8).toUpperCase() : 'N/A');

  const sellerName = sale?.sellerName || req.requestedByName || 'Unknown';

  const productNameSet = new Set<string>();
  origItems.forEach(item => {
    if (item.productName) productNameSet.add(item.productName);
  });
  newItems.forEach(item => {
    if (item.productName) productNameSet.add(item.productName);
  });

  const changes: SaleEditChangeItem[] = [];
  const origMap = new Map(origItems.map(item => [item.productId, item]));
  const newMap = new Map(newItems.map(item => [item.productId, item]));

  origItems.forEach(orig => {
    const updated = newMap.get(orig.productId);
    if (!updated) {
      changes.push({
        kind: 'removed',
        label: orig.productName,
        detail: `Removed (${orig.quantity} × ${formatCurrency(orig.unitPrice, cur)})`,
      });
      return;
    }

    const parts: string[] = [];
    if (orig.quantity !== updated.quantity) {
      parts.push(`Qty ${orig.quantity} -> ${updated.quantity}`);
    }
    if (orig.unitPrice !== updated.unitPrice) {
      parts.push(
        `Price ${formatCurrency(orig.unitPrice, cur)} -> ${formatCurrency(updated.unitPrice, cur)}`
      );
    }
    if ((orig.discount || 0) !== (updated.discount || 0)) {
      parts.push(
        `Discount ${formatCurrency(orig.discount || 0, cur)} -> ${formatCurrency(
          updated.discount || 0,
          cur
        )}`
      );
    }
    if (parts.length > 0) {
      changes.push({
        kind: 'modified',
        label: updated.productName,
        detail: parts.join(', '),
      });
    }
  });

  newItems.forEach(updated => {
    if (!origMap.has(updated.productId)) {
      changes.push({
        kind: 'added',
        label: updated.productName,
        detail: `Added (${updated.quantity} × ${formatCurrency(updated.unitPrice, cur)})`,
      });
    }
  });

  const origTotal = Number(req.originalValues?.total || 0);
  const newTotal = Number(req.newValues?.total || 0);
  if (origTotal !== newTotal || changes.length === 0) {
    changes.push({
      kind: 'total',
      label: 'Total',
      detail: `${formatCurrency(origTotal, cur)} -> ${formatCurrency(newTotal, cur)}`,
    });
  }

  return {
    receiptNumber,
    shopName: resolvedShopName,
    sellerName,
    productNames: Array.from(productNameSet),
    changes,
  };
}

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

export async function printSaleEditsReportPdf(
  requests: SaleEditRequest[],
  salesById: Map<string, Sale>,
  settings: BusinessSettings,
  meta: {
    periodLabel: string;
    statusLabel: string;
    shopLabel: string;
  }
): Promise<boolean> {
  try {
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

    // Banner
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
      truncate(`${meta.shopLabel} | ${meta.statusLabel}`, 58),
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
      'SALE EDITS HISTORY',
      pageWidth - marginRight - 14,
      y - 14,
      11,
      true,
      [0.55, 0.48, 0.96]
    );
    drawRightText(
      `${requests.length} record(s)`,
      pageWidth - marginRight - 14,
      y - 29,
      8.5,
      true,
      [1, 1, 1]
    );
    y -= 66;

    const approvedCount = requests.filter(r => r.status === 'APPROVED').length;
    const rejectedCount = requests.filter(r => r.status === 'REJECTED').length;

    drawRect(marginLeft, y - 22, contentWidth, 26, [0.95, 0.97, 0.99]);
    drawText(`Total Handled: ${requests.length}`, marginLeft + 10, y - 13, 8.5, true);
    drawText(`Approved: ${approvedCount}`, marginLeft + 180, y - 13, 8.5, true, [0.02, 0.52, 0.35]);
    drawText(`Rejected: ${rejectedCount}`, marginLeft + 320, y - 13, 8.5, true, [0.75, 0.15, 0.22]);
    y -= 34;

    const drawHeader = () => {
      drawRect(marginLeft, y - 15, contentWidth, 18, [0.12, 0.16, 0.24]);
      const yH = y - 9;
      drawText('RECEIPT / DATE', marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
      drawText('SHOP / SELLER', marginLeft + 125, yH, 7.5, true, [1, 1, 1]);
      drawText('STATUS', marginLeft + 245, yH, 7.5, true, [1, 1, 1]);
      drawText('CHANGES & REASON', marginLeft + 305, yH, 7.5, true, [1, 1, 1]);
      y -= 22;
    };

    drawHeader();

    const cur = settings.currencySymbol || 'TSh';

    requests.forEach(req => {
      const sale = salesById.get(req.saleId);
      const details = formatSaleEditDetails(req, sale, cur);
      const changeSummary = details.changes.map(c => `${c.label}: ${c.detail}`).join(' | ');
      const neededHeight = 36;
      if (y - neededHeight < 48) {
        pushNewPage();
        drawHeader();
      }

      drawText(`#${truncate(details.receiptNumber, 16)}`, marginLeft + 6, y, 8.5, true);
      drawText(
        truncate(formatDateTime(req.reviewedAt || req.createdAt), 22),
        marginLeft + 6,
        y - 10,
        7,
        false,
        [0.45, 0.5, 0.6]
      );

      drawText(truncate(details.shopName, 20), marginLeft + 125, y, 8, true);
      drawText(
        truncate(`By ${details.sellerName}`, 22),
        marginLeft + 125,
        y - 10,
        7,
        false,
        [0.45, 0.5, 0.6]
      );

      drawText(
        req.status,
        marginLeft + 245,
        y,
        8,
        true,
        req.status === 'APPROVED' ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
      );

      drawText(truncate(changeSummary, 44), marginLeft + 305, y, 8, false);
      drawText(
        truncate(`Reason: ${req.reason || 'N/A'}`, 44),
        marginLeft + 305,
        y - 10,
        7,
        false,
        [0.4, 0.45, 0.55]
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

    const fileName = `sale_edits_history_${new Date().toISOString().slice(0, 10)}.pdf`;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (err) {
    console.error('[saleEditsPrint] printSaleEditsReportPdf failed:', err);
    return false;
  }
}
