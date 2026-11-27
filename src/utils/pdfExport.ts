import type { BusinessSettings, InventoryMovement, Product, Purchase, Sale, Shop } from '../types';
import type {
  ShopProfitLossRow,
  ShopProfitLossSummary,
} from '../services/reportService';
import { formatCurrency, formatDateTime } from './formatters';

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

export interface PdfPrintResult {
  ok: boolean;
  mode?: 'print' | 'fallback_download';
  error?: string;
}

export function downloadPdfBlob(blob: Blob, fileName: string): boolean {
  const cleanName = (fileName || 'report.pdf').replace(/[\\/:*?"<>|]+/g, '_');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = cleanName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

export async function printPdfBlob(
  blob: Blob,
  fallbackFileName: string
): Promise<PdfPrintResult> {
  try {
    const url = URL.createObjectURL(blob);

    return await new Promise(resolve => {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-9999px';
      iframe.style.top = '0';
      iframe.style.width = '1px';
      iframe.style.height = '1px';
      iframe.style.opacity = '0';
      iframe.style.border = '0';
      iframe.style.pointerEvents = 'none';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.src = url;

      let settled = false;
      let cleanedUp = false;

      const cleanup = (delayMs: number = 60000) => {
        if (cleanedUp) return;
        cleanedUp = true;
        window.setTimeout(() => {
          if (iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
          URL.revokeObjectURL(url);
        }, delayMs);
      };

      const fallbackDownload = () => {
        if (settled) return;
        settled = true;
        downloadPdfBlob(blob, fallbackFileName);
        cleanup(2000);
        resolve({ ok: true, mode: 'fallback_download' });
      };

      const timer = window.setTimeout(fallbackDownload, 3500);

      iframe.onload = () => {
        if (settled) return;
        window.clearTimeout(timer);
        window.setTimeout(() => {
          if (settled) return;
          try {
            const win = iframe.contentWindow;
            if (!win) {
              fallbackDownload();
              return;
            }
            const handleAfterPrint = () => {
              win.removeEventListener('afterprint', handleAfterPrint);
              cleanup(1000);
            };
            win.addEventListener('afterprint', handleAfterPrint);
            win.focus();
            win.print();
            settled = true;
            cleanup(60000);
            resolve({ ok: true, mode: 'print' });
          } catch {
            fallbackDownload();
          }
        }, 250);
      };

      iframe.onerror = () => {
        window.clearTimeout(timer);
        fallbackDownload();
      };

      document.body.appendChild(iframe);
    });
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Could not initiate PDF print.',
    };
  }
}

function createPdfBuilder() {
  const pageWidth = 595.28; // A4 width pt
  const pageHeight = 841.89; // A4 height pt
  const marginLeft = 36;
  const marginRight = 36;
  const contentWidth = pageWidth - marginLeft - marginRight;

  const pages: string[][] = [];
  let currentOps: string[] = [];
  let y = pageHeight - 42;

  const pushNewPage = () => {
    if (currentOps.length > 0) {
      pages.push(currentOps);
    }
    currentOps = [];
    y = pageHeight - 42;
  };

  const ensureSpace = (neededHeight: number, onNewPage?: () => void) => {
    if (y - neededHeight < 48) {
      pushNewPage();
      if (onNewPage) onNewPage();
    }
  };

  const drawText = (
    text: string,
    x: number,
    yPos: number,
    size: number = 9.5,
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
    size: number = 9.5,
    bold: boolean = false,
    rgb: [number, number, number] = [0.1, 0.14, 0.2]
  ) => {
    const approxWidth = escapePdfText(text).length * size * (bold ? 0.54 : 0.5);
    drawText(text, Math.max(marginLeft, rightX - approxWidth), yPos, size, bold, rgb);
  };

  const drawLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    lineWidth: number = 0.6,
    rgb: [number, number, number] = [0.82, 0.86, 0.91]
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

  const drawBanner = (
    settings: BusinessSettings,
    reportTitle: string,
    subtitleRight: string,
    metaLine: string
  ) => {
    drawRect(marginLeft, y - 50, contentWidth, 60, [0.06, 0.09, 0.16]);
    drawText(
      truncate(settings.businessName || 'Gmeck Company Limited', 44),
      marginLeft + 14,
      y - 12,
      13.5,
      true,
      [1, 1, 1]
    );
    drawText(
      truncate(settings.tagline || 'Quality Electronics & Solutions', 60),
      marginLeft + 14,
      y - 26,
      8.5,
      false,
      [0.75, 0.82, 0.94]
    );
    drawText(
      truncate([settings.address, settings.phone].filter(Boolean).join('  |  '), 65),
      marginLeft + 14,
      y - 39,
      8,
      false,
      [0.65, 0.72, 0.84]
    );

    drawRightText(
      truncate(reportTitle, 32),
      pageWidth - marginRight - 14,
      y - 13,
      11,
      true,
      [0.38, 0.65, 0.98]
    );
    drawRightText(
      truncate(subtitleRight, 38),
      pageWidth - marginRight - 14,
      y - 27,
      8.5,
      true,
      [1, 1, 1]
    );
    drawRightText(
      truncate(metaLine, 42),
      pageWidth - marginRight - 14,
      y - 40,
      7.5,
      false,
      [0.7, 0.78, 0.88]
    );

    y -= 66;
  };

  const buildBlob = (): Blob => {
    if (currentOps.length > 0) {
      pages.push(currentOps);
      currentOps = [];
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

    return new Blob([bytes], { type: 'application/pdf' });
  };

  const download = (fileName: string): boolean => {
    return downloadPdfBlob(buildBlob(), fileName);
  };

  const print = async (fallbackFileName: string): Promise<PdfPrintResult> => {
    return printPdfBlob(buildBlob(), fallbackFileName);
  };

  return {
    pageWidth,
    pageHeight,
    marginLeft,
    marginRight,
    contentWidth,
    getY: () => y,
    setY: (val: number) => {
      y = val;
    },
    advanceY: (delta: number) => {
      y -= delta;
    },
    pushNewPage,
    ensureSpace,
    drawText,
    drawRightText,
    drawLine,
    drawRect,
    drawBanner,
    download,
    print,
  };
}

function formatDateRangeLabel(from?: string, to?: string): string {
  if (from && to) return from === to ? from : `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Up to ${to}`;
  return 'All Time';
}

function buildFinancialReportDoc(
  summary: any,
  settings: BusinessSettings,
  meta: {
    shopLabel: string;
    from?: string;
    to?: string;
    periodKey: string;
    periodLabel: string;
  }
) {
  const doc = createPdfBuilder();
    const cur = settings.currencySymbol || 'TSh';
    const dateRangeStr = formatDateRangeLabel(meta.from, meta.to);

    doc.drawBanner(
      settings,
      'FINANCIAL REPORT',
      `${meta.shopLabel} | ${meta.periodLabel}`,
      `Period: ${dateRangeStr}`
    );

    const drawSectionHeading = (title: string) => {
      doc.ensureSpace(44);
      doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 20, [0.12, 0.16, 0.24]);
      doc.drawText(title, doc.marginLeft + 10, doc.getY() - 9, 9.5, true, [1, 1, 1]);
      doc.advanceY(26);
    };

    // 1. Income Statement
    drawSectionHeading(`INCOME STATEMENT (${summary?.transactionCount || 0} completed sales)`);
    const incomeRows: Array<{
      label: string;
      val: string;
      bold?: boolean;
      color?: [number, number, number];
      bg?: [number, number, number];
    }> = [
      {
        label: 'Gross Revenue',
        val: formatCurrency(summary?.totalGrossSales || 0, cur),
        bold: true,
      },
      {
        label: 'Less: Cost of Goods Sold (COGS)',
        val: `-${formatCurrency(summary?.totalCostOfGoods || 0, cur)}`,
        color: [0.75, 0.15, 0.22],
      },
      {
        label: `Gross Profit (${summary?.profitMarginPercent || 0}% margin)`,
        val: formatCurrency(summary?.totalGrossProfit || 0, cur),
        bold: true,
        color: [0.02, 0.52, 0.35],
        bg: [0.94, 0.99, 0.96],
      },
      {
        label: 'Less: Operating Expenses',
        val: `-${formatCurrency(summary?.totalExpenses || 0, cur)}`,
        color: [0.75, 0.15, 0.22],
      },
      {
        label: `NET PROFIT (${summary?.netMarginPercent || 0}% net return)`,
        val: formatCurrency(summary?.netProfit || 0, cur),
        bold: true,
        color: (summary?.netProfit || 0) >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22],
        bg: (summary?.netProfit || 0) >= 0 ? [0.91, 0.98, 0.94] : [0.99, 0.94, 0.94],
      },
    ];

    incomeRows.forEach(r => {
      doc.ensureSpace(22);
      const y = doc.getY();
      if (r.bg) {
        doc.drawRect(doc.marginLeft, y - 5, doc.contentWidth, 18, r.bg);
      }
      doc.drawText(r.label, doc.marginLeft + 10, y, 9.5, Boolean(r.bold), r.color || [0.12, 0.16, 0.22]);
      doc.drawRightText(
        r.val,
        doc.pageWidth - doc.marginRight - 10,
        y,
        9.5,
        Boolean(r.bold),
        r.color || [0.12, 0.16, 0.22]
      );
      doc.advanceY(14);
      doc.drawLine(doc.marginLeft, doc.getY() + 4, doc.pageWidth - doc.marginRight, doc.getY() + 4, 0.4, [0.9, 0.92, 0.95]);
      doc.advanceY(6);
    });
    doc.advanceY(8);

    // 2. Shop Performance
    const shops = (summary?.shopSalesBreakdown || []) as any[];
    if (shops.length > 0) {
      drawSectionHeading('SHOP PERFORMANCE');
      doc.drawText('SHOP', doc.marginLeft + 8, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('SALES', doc.marginLeft + 300, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('REVENUE', doc.marginLeft + 410, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('GROSS PROFIT', doc.pageWidth - doc.marginRight - 8, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.advanceY(12);
      doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.6);
      doc.advanceY(6);

      shops.forEach(sh => {
        doc.ensureSpace(20);
        const y = doc.getY();
        doc.drawText(truncate(sh.name || 'Shop', 38), doc.marginLeft + 8, y, 9, true);
        doc.drawRightText(String(sh.salesCount || 0), doc.marginLeft + 300, y, 9);
        doc.drawRightText(formatCurrency(sh.totalSales || 0, cur), doc.marginLeft + 410, y, 9);
        doc.drawRightText(
          formatCurrency(sh.grossProfit || 0, cur),
          doc.pageWidth - doc.marginRight - 8,
          y,
          9,
          true,
          (sh.grossProfit || 0) >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
        );
        doc.advanceY(16);
      });
      doc.advanceY(8);
    }

    // 3. Top Products
    const topProds = ((summary?.topProducts || []) as any[]).slice(0, 35);
    if (topProds.length > 0) {
      drawSectionHeading(`PRODUCT PROFITABILITY (TOP ${topProds.length})`);
      doc.drawText('PRODUCT', doc.marginLeft + 8, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('UNITS', doc.marginLeft + 310, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('REVENUE', doc.marginLeft + 415, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('PROFIT', doc.pageWidth - doc.marginRight - 8, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.advanceY(12);
      doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.6);
      doc.advanceY(6);

      topProds.forEach(p => {
        doc.ensureSpace(18);
        const y = doc.getY();
        doc.drawText(truncate(`${p.name} (${p.sku || ''})`, 46), doc.marginLeft + 8, y, 8.5, false);
        doc.drawRightText(String(p.unitsSold || 0), doc.marginLeft + 310, y, 8.5);
        doc.drawRightText(formatCurrency(p.revenue || 0, cur), doc.marginLeft + 415, y, 8.5);
        doc.drawRightText(
          formatCurrency(p.profit || 0, cur),
          doc.pageWidth - doc.marginRight - 8,
          y,
          8.5,
          true,
          (p.profit || 0) >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
        );
        doc.advanceY(15);
      });
      doc.advanceY(8);
    }

    // 4. Seller Performance
    const sellers = (summary?.sellerSales || []) as any[];
    if (sellers.length > 0) {
      drawSectionHeading('SELLER PERFORMANCE');
      doc.drawText('SELLER', doc.marginLeft + 8, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('ORDERS', doc.marginLeft + 300, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('TOTAL SALES', doc.marginLeft + 410, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.drawRightText('PROFIT', doc.pageWidth - doc.marginRight - 8, doc.getY(), 8, true, [0.4, 0.45, 0.55]);
      doc.advanceY(12);
      doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.6);
      doc.advanceY(6);

      sellers.forEach(se => {
        doc.ensureSpace(18);
        const y = doc.getY();
        doc.drawText(truncate(se.name || 'Seller', 36), doc.marginLeft + 8, y, 9, true);
        doc.drawRightText(String(se.count || 0), doc.marginLeft + 300, y, 9);
        doc.drawRightText(formatCurrency(se.total || 0, cur), doc.marginLeft + 410, y, 9);
        doc.drawRightText(
          formatCurrency(se.profit || 0, cur),
          doc.pageWidth - doc.marginRight - 8,
          y,
          9,
          true,
          [0.02, 0.52, 0.35]
        );
        doc.advanceY(16);
      });
    }

  const fileName = `financial_report_${meta.periodKey}_${new Date().toISOString().slice(0, 10)}.pdf`;
  return { doc, fileName };
}

export async function downloadFinancialReportPdf(
  summary: any,
  settings: BusinessSettings,
  meta: {
    shopLabel: string;
    from?: string;
    to?: string;
    periodKey: string;
    periodLabel: string;
  }
): Promise<boolean> {
  try {
    const { doc, fileName } = buildFinancialReportDoc(summary, settings, meta);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadFinancialReportPdf failed:', err);
    return false;
  }
}

export async function printFinancialReportPdf(
  summary: any,
  settings: BusinessSettings,
  meta: {
    shopLabel: string;
    from?: string;
    to?: string;
    periodKey: string;
    periodLabel: string;
  }
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildFinancialReportDoc(summary, settings, meta);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printFinancialReportPdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare financial report for printing.' };
  }
}

function buildPriceDeviationsDoc(
  deviations: Array<{
    receiptNumber: string;
    createdAt: string;
    shopName: string;
    sellerDisplayName: string;
    productName: string;
    sku: string;
    referencePrice: number;
    soldPrice: number;
    quantity: number;
    totalImpact: number;
    direction: 'ABOVE' | 'BELOW';
    belowCost: boolean;
    costLoss: number;
  }>,
  deviationStats: {
    belowCount: number;
    aboveCount: number;
    belowCostCount: number;
    belowSalesCount: number;
    aboveSalesCount: number;
    belowImpact: number;
    aboveImpact: number;
    costLoss: number;
    netImpact: number;
  },
  settings: BusinessSettings,
  meta: {
    shopLabel: string;
    from?: string;
    to?: string;
    direction: string;
  }
) {
  const doc = createPdfBuilder();
    const cur = settings.currencySymbol || 'TSh';
    const dateRangeStr = formatDateRangeLabel(meta.from, meta.to);

    doc.drawBanner(
      settings,
      'PRICE DEVIATION AUDIT',
      `${meta.shopLabel} | Filter: ${meta.direction}`,
      `Period: ${dateRangeStr}`
    );

    // Summary strip
    doc.drawRect(doc.marginLeft, doc.getY() - 44, doc.contentWidth, 48, [0.96, 0.97, 0.99]);
    const y0 = doc.getY();
    doc.drawText(`Below Ref: ${deviationStats.belowCount} items`, doc.marginLeft + 10, y0 - 12, 8.5, true, [0.75, 0.15, 0.22]);
    doc.drawText(
      `Impact: ${formatCurrency(deviationStats.belowImpact, cur)}`,
      doc.marginLeft + 10,
      y0 - 25,
      8.5,
      false
    );

    doc.drawText(`Below Cost (Loss): ${deviationStats.belowCostCount}`, doc.marginLeft + 165, y0 - 12, 8.5, true, [0.8, 0.35, 0.05]);
    doc.drawText(
      `Real Loss: -${formatCurrency(deviationStats.costLoss, cur)}`,
      doc.marginLeft + 165,
      y0 - 25,
      8.5,
      false
    );

    doc.drawText(`Above Ref: ${deviationStats.aboveCount} items`, doc.marginLeft + 320, y0 - 12, 8.5, true, [0.02, 0.52, 0.35]);
    doc.drawText(
      `Gain: +${formatCurrency(deviationStats.aboveImpact, cur)}`,
      doc.marginLeft + 320,
      y0 - 25,
      8.5,
      false
    );

    doc.drawText(
      `NET IMPACT: ${deviationStats.netImpact >= 0 ? '+' : ''}${formatCurrency(deviationStats.netImpact, cur)}`,
      doc.marginLeft + 10,
      y0 - 39,
      9,
      true,
      deviationStats.netImpact >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
    );
    doc.advanceY(58);

    const drawHeader = () => {
      doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
      const yH = doc.getY() - 9;
      doc.drawText('PRODUCT / RECEIPT', doc.marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
      doc.drawText('SELLER', doc.marginLeft + 205, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('REF PRICE', doc.marginLeft + 350, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('SOLD AT', doc.marginLeft + 415, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('QTY', doc.marginLeft + 450, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('IMPACT', doc.pageWidth - doc.marginRight - 6, yH, 7.5, true, [1, 1, 1]);
      doc.advanceY(22);
    };

    drawHeader();

    deviations.forEach(d => {
      doc.ensureSpace(28, drawHeader);
      const y = doc.getY();
      const prodLabel = d.belowCost ? `[LOSS] ${d.productName}` : d.productName;
      doc.drawText(truncate(prodLabel, 34), doc.marginLeft + 6, y, 8.5, true);
      doc.drawText(
        truncate(`${d.receiptNumber} | ${formatDateTime(d.createdAt).slice(0, 12)}`, 36),
        doc.marginLeft + 6,
        y - 10,
        7,
        false,
        [0.45, 0.5, 0.6]
      );
      doc.drawText(truncate(d.sellerDisplayName, 18), doc.marginLeft + 205, y, 8, false);
      doc.drawRightText(
        d.referencePrice > 0 ? formatCurrency(d.referencePrice, cur) : '-',
        doc.marginLeft + 350,
        y,
        8
      );
      doc.drawRightText(
        formatCurrency(d.soldPrice, cur),
        doc.marginLeft + 415,
        y,
        8,
        true,
        d.belowCost ? [0.8, 0.35, 0.05] : d.direction === 'BELOW' ? [0.75, 0.15, 0.22] : [0.02, 0.52, 0.35]
      );
      doc.drawRightText(String(d.quantity), doc.marginLeft + 450, y, 8);
      const impactText =
        d.referencePrice > 0
          ? `${d.totalImpact > 0 ? '+' : ''}${formatCurrency(d.totalImpact, cur)}`
          : `-${formatCurrency(d.costLoss, cur)}`;
      doc.drawRightText(
        impactText,
        doc.pageWidth - doc.marginRight - 6,
        y,
        8.5,
        true,
        d.belowCost ? [0.8, 0.35, 0.05] : d.direction === 'BELOW' ? [0.75, 0.15, 0.22] : [0.02, 0.52, 0.35]
      );
      doc.advanceY(18);
      doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.4, [0.9, 0.92, 0.95]);
      doc.advanceY(5);
    });

  const fileName = `price_deviations_${meta.direction.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.pdf`;
  return { doc, fileName };
}

export async function downloadPriceDeviationsPdf(
  deviations: Parameters<typeof buildPriceDeviationsDoc>[0],
  deviationStats: Parameters<typeof buildPriceDeviationsDoc>[1],
  settings: BusinessSettings,
  meta: Parameters<typeof buildPriceDeviationsDoc>[3]
): Promise<boolean> {
  try {
    const { doc, fileName } = buildPriceDeviationsDoc(deviations, deviationStats, settings, meta);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadPriceDeviationsPdf failed:', err);
    return false;
  }
}

export async function printPriceDeviationsPdf(
  deviations: Parameters<typeof buildPriceDeviationsDoc>[0],
  deviationStats: Parameters<typeof buildPriceDeviationsDoc>[1],
  settings: BusinessSettings,
  meta: Parameters<typeof buildPriceDeviationsDoc>[3]
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildPriceDeviationsDoc(deviations, deviationStats, settings, meta);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printPriceDeviationsPdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare price deviations for printing.' };
  }
}

function buildShopProfitLossDoc(
  rows: ShopProfitLossRow[],
  totals: ShopProfitLossSummary['totals'],
  generalCompanyExpenses: number,
  settings: BusinessSettings,
  meta: {
    from?: string;
    to?: string;
    periodLabel: string;
  }
) {
  const doc = createPdfBuilder();
    const cur = settings.currencySymbol || 'TSh';
    const dateRangeStr = formatDateRangeLabel(meta.from, meta.to);

    doc.drawBanner(
      settings,
      'SHOP PROFIT & LOSS',
      `Period: ${meta.periodLabel.toUpperCase()}`,
      `Dates: ${dateRangeStr}`
    );

    // Consolidated Summary Box
    const y0 = doc.getY();
    doc.drawRect(doc.marginLeft, y0 - 44, doc.contentWidth, 48, [0.95, 0.97, 0.99]);
    doc.drawText('CONSOLIDATED P&L SUMMARY', doc.marginLeft + 10, y0 - 11, 8.5, true, [0.12, 0.25, 0.5]);
    doc.drawText(
      `Product Capital: ${formatCurrency(totals.totalCapital, cur)} (${totals.skuCount} SKUs / ${totals.totalUnits} units)`,
      doc.marginLeft + 10,
      y0 - 24,
      8.5
    );
    doc.drawText(
      `Revenue: ${formatCurrency(totals.revenue, cur)} | Gross Profit: ${formatCurrency(totals.grossProfit, cur)}`,
      doc.marginLeft + 10,
      y0 - 37,
      8.5
    );
    doc.drawRightText(
      `Exp & Losses: -${formatCurrency(totals.totalLossAndExpenses, cur)}`,
      doc.pageWidth - doc.marginRight - 10,
      y0 - 24,
      8.5,
      false,
      [0.75, 0.15, 0.22]
    );
    doc.drawRightText(
      `NET P&L: ${totals.netProfit >= 0 ? '+' : ''}${formatCurrency(totals.netProfit, cur)}`,
      doc.pageWidth - doc.marginRight - 10,
      y0 - 37,
      9.5,
      true,
      totals.netProfit >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
    );
    doc.advanceY(58);

    const drawHeader = () => {
      doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
      const yH = doc.getY() - 9;
      doc.drawText('SHOP', doc.marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('CAPITAL', doc.marginLeft + 195, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('REVENUE', doc.marginLeft + 275, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('GROSS P.', doc.marginLeft + 355, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('EXP/LOSS', doc.marginLeft + 435, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('NET P&L', doc.pageWidth - doc.marginRight - 6, yH, 7.5, true, [1, 1, 1]);
      doc.advanceY(22);
    };

    drawHeader();

    rows.forEach(row => {
      doc.ensureSpace(32, drawHeader);
      const y = doc.getY();
      doc.drawText(truncate(row.shopName, 22), doc.marginLeft + 6, y, 8.5, true);
      doc.drawText(
        `${row.skuCount} SKUs | ${row.totalUnits}u (F:${row.floorUnits} S:${row.storeUnits})`,
        doc.marginLeft + 6,
        y - 10,
        7,
        false,
        [0.45, 0.5, 0.6]
      );
      doc.drawRightText(formatCurrency(row.totalCapital, cur), doc.marginLeft + 195, y, 8);
      doc.drawRightText(formatCurrency(row.revenue, cur), doc.marginLeft + 275, y, 8);
      doc.drawRightText(
        formatCurrency(row.grossProfit, cur),
        doc.marginLeft + 355,
        y,
        8,
        false,
        row.grossProfit >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
      );
      doc.drawRightText(
        `-${formatCurrency(row.totalLossAndExpenses, cur)}`,
        doc.marginLeft + 435,
        y,
        8,
        false,
        [0.75, 0.15, 0.22]
      );
      doc.drawRightText(
        `${row.netProfit >= 0 ? '+' : ''}${formatCurrency(row.netProfit, cur)}`,
        doc.pageWidth - doc.marginRight - 6,
        y,
        8.5,
        true,
        row.netProfit >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
      );
      doc.drawRightText(
        `${row.netMarginPercent}% | ROI ${row.capitalReturnPercent}%`,
        doc.pageWidth - doc.marginRight - 6,
        y - 10,
        6.8,
        false,
        [0.45, 0.5, 0.6]
      );
      doc.advanceY(20);
      doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.4, [0.9, 0.92, 0.95]);
      doc.advanceY(6);
    });

    if (generalCompanyExpenses > 0) {
      doc.ensureSpace(34);
      doc.advanceY(4);
      doc.drawRect(doc.marginLeft, doc.getY() - 22, doc.contentWidth, 26, [0.99, 0.96, 0.91]);
      doc.drawText(
        `Unallocated Company Expenses: -${formatCurrency(generalCompanyExpenses, cur)}`,
        doc.marginLeft + 10,
        doc.getY() - 12,
        8.5,
        true,
        [0.65, 0.25, 0.05]
      );
      doc.drawRightText(
        `Company Net: ${totals.netAfterCompanyExpenses >= 0 ? '+' : ''}${formatCurrency(totals.netAfterCompanyExpenses, cur)}`,
        doc.pageWidth - doc.marginRight - 10,
        doc.getY() - 12,
        9,
        true,
        totals.netAfterCompanyExpenses >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
      );
    }

  const fileName = `shop_profit_and_loss_${meta.periodLabel}_${new Date().toISOString().slice(0, 10)}.pdf`;
  return { doc, fileName };
}

export async function downloadShopProfitLossPdf(
  rows: ShopProfitLossRow[],
  totals: ShopProfitLossSummary['totals'],
  generalCompanyExpenses: number,
  settings: BusinessSettings,
  meta: {
    from?: string;
    to?: string;
    periodLabel: string;
  }
): Promise<boolean> {
  try {
    const { doc, fileName } = buildShopProfitLossDoc(
      rows,
      totals,
      generalCompanyExpenses,
      settings,
      meta
    );
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadShopProfitLossPdf failed:', err);
    return false;
  }
}

export async function printShopProfitLossPdf(
  rows: ShopProfitLossRow[],
  totals: ShopProfitLossSummary['totals'],
  generalCompanyExpenses: number,
  settings: BusinessSettings,
  meta: {
    from?: string;
    to?: string;
    periodLabel: string;
  }
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildShopProfitLossDoc(
      rows,
      totals,
      generalCompanyExpenses,
      settings,
      meta
    );
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printShopProfitLossPdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare Shop P&L for printing.' };
  }
}

function buildSalesReportDoc(
  sales: Sale[],
  settings: BusinessSettings,
  meta: {
    shopLabel: string;
    startDate?: string;
    endDate?: string;
    periodKey: string;
    periodTitle: string;
    periodLabel: string;
    dateRangeText: string;
    sellerLabel?: string;
    paymentLabel?: string;
    statusLabel?: string;
    searchQuery?: string;
    totalRevenue: number;
    totalProfit: number;
    products?: Product[];
  }
) {
  const doc = createPdfBuilder();
  const cur = settings.currencySymbol || 'TSh';

  doc.drawBanner(
    settings,
    meta.periodTitle.toUpperCase(),
    `${meta.shopLabel} | ${meta.periodLabel}`,
    `Dates: ${meta.dateRangeText}`
  );

  const productById = new Map<string, Product>((meta.products || []).map(p => [p.id, p]));

  interface SoldItemEntryRow {
    productName: string;
    qtySold: number;
    unit?: string;
    totalSales: number;
    totalProfit: number;
  }

  const saleItemRows: SoldItemEntryRow[] = [];
  let computedSalesSum = 0;
  let computedProfitSum = 0;

  for (const sale of sales) {
    if (sale.status !== 'COMPLETED') continue;
    const rawItemsTotal = (sale.items || []).reduce((s, it) => s + (Number(it.total) || 0), 0);
    const scale =
      rawItemsTotal > 0 && Number.isFinite(sale.total)
        ? Math.max(0, Number(sale.total) || 0) / rawItemsTotal
        : 1;

    for (const item of sale.items || []) {
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;

      const matchedProd = item.productId ? productById.get(item.productId) : undefined;
      const baseName = (matchedProd?.name || item.productName || 'Unnamed Product').trim();
      const fullName =
        matchedProd?.variation && !baseName.toLowerCase().includes(matchedProd.variation.toLowerCase())
          ? `${baseName} (${matchedProd.variation})`
          : baseName;

      const itemRev = (Number(item.total) || 0) * scale;
      const itemCost = (Number(item.purchasePrice ?? matchedProd?.purchasePrice) || 0) * qty;
      const itemProfit = itemRev - itemCost;

      computedSalesSum += itemRev;
      computedProfitSum += itemProfit;

      saleItemRows.push({
        productName: fullName,
        qtySold: qty,
        unit: matchedProd?.unit,
        totalSales: itemRev,
        totalProfit: itemProfit,
      });
    }
  }

  const totalUnitsSold = saleItemRows.reduce((s, r) => s + r.qtySold, 0);
  const displayTotalRevenue =
    Number.isFinite(meta.totalRevenue) && (meta.totalRevenue > 0 || computedSalesSum === 0)
      ? meta.totalRevenue
      : computedSalesSum;
  const displayTotalProfit =
    Number.isFinite(meta.totalProfit) && (meta.totalProfit !== 0 || computedProfitSum === 0)
      ? meta.totalProfit
      : computedProfitSum;

  // Summary strip matching Remained Products design
  const y0 = doc.getY();
  doc.drawRect(doc.marginLeft, y0 - 40, doc.contentWidth, 44, [0.95, 0.97, 0.99]);
  doc.drawText(
    `Items Sold: ${saleItemRows.length}   |   Total Qty: ${Number(totalUnitsSold.toFixed(3)).toLocaleString()}`,
    doc.marginLeft + 10,
    y0 - 12,
    8.5,
    true,
    [0.12, 0.25, 0.5]
  );
  const activeFilterParts = [
    meta.sellerLabel && meta.sellerLabel !== 'All Sellers' ? `Seller: ${meta.sellerLabel}` : null,
    meta.paymentLabel && meta.paymentLabel !== 'All Payment Methods'
      ? `Payment: ${meta.paymentLabel}`
      : null,
    meta.searchQuery ? `Search: "${meta.searchQuery}"` : null,
  ].filter(Boolean);
  doc.drawText(
    truncate(activeFilterParts.join('  |  ') || `${meta.periodLabel} (${meta.dateRangeText})`, 66),
    doc.marginLeft + 10,
    y0 - 26,
    7.8,
    false,
    [0.35, 0.4, 0.5]
  );
  doc.drawRightText(
    `Total Sales: ${formatCurrency(displayTotalRevenue, cur)}`,
    doc.pageWidth - doc.marginRight - 10,
    y0 - 12,
    8.8,
    true,
    [0.12, 0.25, 0.5]
  );
  doc.drawRightText(
    `Gross Profit: ${formatCurrency(displayTotalProfit, cur)}`,
    doc.pageWidth - doc.marginRight - 10,
    y0 - 27,
    8.5,
    true,
    displayTotalProfit >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
  );
  doc.advanceY(54);

  const tableLeftX = doc.marginLeft;
  const colNumEnd = doc.marginLeft + 26;
  const colProdEnd = doc.marginLeft + 258;
  const colQtyEnd = doc.marginLeft + 342;
  const colSalesEnd = doc.marginLeft + 434;
  const tableRightX = doc.pageWidth - doc.marginRight;
  const colDividers = [tableLeftX, colNumEnd, colProdEnd, colQtyEnd, colSalesEnd, tableRightX];

  const drawHeader = () => {
    const headerTop = doc.getY() + 3;
    const headerBottom = doc.getY() - 15;
    doc.drawRect(tableLeftX, headerBottom, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
    for (const dx of colDividers) {
      doc.drawLine(dx, headerBottom, dx, headerTop, 0.6, [0.3, 0.36, 0.46]);
    }
    const yH = doc.getY() - 9;
    doc.drawText('#', tableLeftX + 6, yH, 7.5, true, [1, 1, 1]);
    doc.drawText('PRODUCT NAME', colNumEnd + 8, yH, 7.5, true, [1, 1, 1]);
    doc.drawRightText('QTY SOLD', colQtyEnd - 8, yH, 7.5, true, [1, 1, 1]);
    doc.drawRightText('TOTAL SALES', colSalesEnd - 8, yH, 7.5, true, [1, 1, 1]);
    doc.drawRightText('PROFIT', tableRightX - 8, yH, 7.5, true, [1, 1, 1]);
    doc.advanceY(22);
  };

  drawHeader();

  if (saleItemRows.length === 0) {
    doc.drawText(
      'No sold products recorded for the selected period/filters.',
      doc.marginLeft + 10,
      doc.getY(),
      9,
      false,
      [0.45, 0.5, 0.6]
    );
  } else {
    saleItemRows.forEach((row, idx) => {
      doc.ensureSpace(24, drawHeader);
      const y = doc.getY();
      const rowTop = y + 9;
      const unitSuffix = row.unit ? ` ${row.unit}` : '';
      const qtyStr = `${Number(row.qtySold.toFixed(3))}${unitSuffix}`;

      doc.drawText(String(idx + 1), tableLeftX + 6, y, 8, false, [0.4, 0.45, 0.55]);
      doc.drawText(
        truncate(row.productName || 'Unnamed Product', 40),
        colNumEnd + 8,
        y,
        8.2,
        true
      );
      doc.drawRightText(qtyStr, colQtyEnd - 8, y, 8.2, true, [0.15, 0.38, 0.72]);
      doc.drawRightText(
        formatCurrency(row.totalSales, cur),
        colSalesEnd - 8,
        y,
        8.2,
        true
      );
      doc.drawRightText(
        `${row.totalProfit >= 0 ? '+' : ''}${formatCurrency(row.totalProfit, cur)}`,
        tableRightX - 8,
        y,
        8.2,
        true,
        row.totalProfit >= 0 ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
      );

      doc.advanceY(15);
      const rowBottom = doc.getY() + 3;
      for (const dx of colDividers) {
        doc.drawLine(dx, rowBottom, dx, rowTop, 0.5, [0.86, 0.89, 0.93]);
      }
      doc.drawLine(tableLeftX, rowBottom, tableRightX, rowBottom, 0.5, [0.86, 0.89, 0.93]);
      doc.advanceY(5);
    });
  }

  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  const fileName = `sales_report_${meta.periodKey}_${meta.shopLabel
    .toLowerCase()
    .replace(/\s+/g, '_')}_${dateTag}.pdf`;
  return { doc, fileName };
}

export async function downloadSalesReportPdf(
  sales: Sale[],
  settings: BusinessSettings,
  meta: Parameters<typeof buildSalesReportDoc>[2]
): Promise<boolean> {
  try {
    const { doc, fileName } = buildSalesReportDoc(sales, settings, meta);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadSalesReportPdf failed:', err);
    return false;
  }
}

export async function printSalesReportPdf(
  sales: Sale[],
  settings: BusinessSettings,
  meta: Parameters<typeof buildSalesReportDoc>[2]
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildSalesReportDoc(sales, settings, meta);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printSalesReportPdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare sales report for printing.' };
  }
}

export type InventoryExportScope = 'ALL' | 'SHOP' | 'STORE' | 'MIXED';

export interface InventoryExportRow {
  shopName: string;
  productName: string;
  variation: string;
  sku: string;
  unit: string;
  shopQty: number;
  storeQty: number;
  totalQty: number;
  activeQty: number;
  rowScope: 'ALL' | 'SHOP' | 'STORE';
  minStock: number;
  purchasePrice: number;
  sellingPrice: number;
  buyValue: number;
  sellValue: number;
  potentialProfit: number;
  storeBreakdown: string;
  status: 'IN STOCK' | 'LOW STOCK' | 'OUT OF STOCK' | 'INACTIVE';
}

export interface InventoryExportMeta {
  scope: InventoryExportScope;
  shopLabel: string;
  searchQuery?: string;
  lowStockOnly?: boolean;
}

function buildInventoryReportDoc(
  rows: InventoryExportRow[],
  settings: BusinessSettings,
  meta: InventoryExportMeta
) {
  const doc = createPdfBuilder();
    const cur = settings.currencySymbol || 'TSh';
    const scopeText =
      meta.scope === 'SHOP'
        ? 'Shop Stock Only'
        : meta.scope === 'STORE'
          ? 'Store Stock Only'
          : meta.scope === 'MIXED'
            ? 'Filtered (Shop / Store)'
            : 'All (Shop + Store)';

    doc.drawBanner(
      settings,
      'INVENTORY VALUATION',
      `${meta.shopLabel} | ${scopeText}`,
      `Generated: ${new Date().toLocaleString()}`
    );

    const totalUnits = rows.reduce((s, r) => s + r.activeQty, 0);
    const totalBuy = rows.reduce((s, r) => s + r.buyValue, 0);
    const totalSell = rows.reduce((s, r) => s + r.sellValue, 0);
    const totalMargin = totalSell - totalBuy;

    const y0 = doc.getY();
    doc.drawRect(doc.marginLeft, y0 - 42, doc.contentWidth, 46, [0.95, 0.97, 0.99]);
    doc.drawText(
      `SKUs: ${rows.length}  |  Total Units: ${totalUnits.toLocaleString()}`,
      doc.marginLeft + 10,
      y0 - 12,
      8.5,
      true,
      [0.12, 0.25, 0.5]
    );
    const filterNotes = [
      meta.lowStockOnly ? 'Low Stock Only' : null,
      meta.searchQuery ? `Search: "${meta.searchQuery}"` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    doc.drawText(
      truncate(filterNotes || `Scope: ${scopeText}`, 58),
      doc.marginLeft + 10,
      y0 - 26,
      7.8,
      false,
      [0.4, 0.45, 0.55]
    );
    doc.drawRightText(
      `Buy Total: ${formatCurrency(totalBuy, cur)}`,
      doc.pageWidth - doc.marginRight - 10,
      y0 - 12,
      8.5,
      true,
      [0.45, 0.25, 0.7]
    );
    doc.drawRightText(
      `Sell Total: ${formatCurrency(totalSell, cur)} (+${formatCurrency(totalMargin, cur)})`,
      doc.pageWidth - doc.marginRight - 10,
      y0 - 27,
      8.5,
      true,
      [0.02, 0.52, 0.35]
    );
    doc.advanceY(56);

    const drawHeader = () => {
      doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
      const yH = doc.getY() - 9;
      doc.drawText('PRODUCT / SHOP', doc.marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('QTY', doc.marginLeft + 265, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('BUY', doc.marginLeft + 335, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('SELL', doc.marginLeft + 405, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('BUY TOTAL', doc.marginLeft + 468, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('SELL TOTAL', doc.pageWidth - doc.marginRight - 6, yH, 7.5, true, [1, 1, 1]);
      doc.advanceY(22);
    };

    drawHeader();

    rows.forEach(r => {
      doc.ensureSpace(30, drawHeader);
      const y = doc.getY();
      const title = r.variation ? `${r.productName} (${r.variation})` : r.productName;
      doc.drawText(truncate(title, 34), doc.marginLeft + 6, y, 8, true);
      const subLine =
        r.rowScope === 'ALL' && r.storeQty > 0
          ? `${r.shopName} | Shop:${r.shopQty} Store:${r.storeQty} | ${r.sku}`
          : `${r.shopName} | ${r.sku} | ${r.status}`;
      doc.drawText(truncate(subLine, 42), doc.marginLeft + 6, y - 10, 6.8, false, [0.45, 0.5, 0.6]);

      doc.drawRightText(`${r.activeQty} ${r.unit}`, doc.marginLeft + 265, y, 8, true);
      doc.drawRightText(formatCurrency(r.purchasePrice, cur), doc.marginLeft + 335, y, 7.8);
      doc.drawRightText(formatCurrency(r.sellingPrice, cur), doc.marginLeft + 405, y, 7.8);
      doc.drawRightText(formatCurrency(r.buyValue, cur), doc.marginLeft + 468, y, 7.8, false, [0.45, 0.25, 0.7]);
      doc.drawRightText(
        formatCurrency(r.sellValue, cur),
        doc.pageWidth - doc.marginRight - 6,
        y,
        8,
        true,
        [0.02, 0.52, 0.35]
      );

      doc.advanceY(19);
      doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.4, [0.9, 0.92, 0.95]);
      doc.advanceY(5);
    });

  const cleanShop = (meta.shopLabel || 'inventory').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const fileName = `inventory_${meta.scope.toLowerCase()}_${cleanShop}_${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
  return { doc, fileName };
}

export async function downloadInventoryReportPdf(
  rows: InventoryExportRow[],
  settings: BusinessSettings,
  meta: InventoryExportMeta
): Promise<boolean> {
  try {
    const { doc, fileName } = buildInventoryReportDoc(rows, settings, meta);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadInventoryReportPdf failed:', err);
    return false;
  }
}

export async function printInventoryReportPdf(
  rows: InventoryExportRow[],
  settings: BusinessSettings,
  meta: InventoryExportMeta
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildInventoryReportDoc(rows, settings, meta);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printInventoryReportPdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare inventory report for printing.' };
  }
}

function buildLowStockReportDoc(
  products: Product[],
  shops: Shop[],
  settings: BusinessSettings,
  scopeLabel: string
) {
  const doc = createPdfBuilder();
    const cur = settings.currencySymbol || 'TSh';
    const shopsById = new Map(shops.map(s => [s.id, s.name]));

    const totalUnitsNeeded = products.reduce(
      (sum, p) => sum + Math.max(0, p.minStock - p.currentStock),
      0
    );
    const estimatedRestockCost = products.reduce(
      (sum, p) => sum + Math.max(0, p.minStock - p.currentStock) * (p.purchasePrice || 0),
      0
    );

    doc.drawBanner(
      settings,
      'LOW STOCK & RESTOCK',
      scopeLabel,
      `Generated: ${new Date().toLocaleString()}`
    );

    const y0 = doc.getY();
    doc.drawRect(doc.marginLeft, y0 - 26, doc.contentWidth, 30, [0.99, 0.97, 0.92]);
    doc.drawText(`Low Stock SKUs: ${products.length}`, doc.marginLeft + 10, y0 - 15, 8.5, true, [0.7, 0.38, 0.04]);
    doc.drawText(`Units Needed: ${totalUnitsNeeded}`, doc.marginLeft + 170, y0 - 15, 8.5, true, [0.45, 0.25, 0.7]);
    doc.drawRightText(
      `Est. Restock Cost: ${formatCurrency(estimatedRestockCost, cur)}`,
      doc.pageWidth - doc.marginRight - 10,
      y0 - 15,
      8.5,
      true,
      [0.75, 0.15, 0.22]
    );
    doc.advanceY(40);

    const drawHeader = () => {
      doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
      const yH = doc.getY() - 9;
      doc.drawText('PRODUCT / SHOP', doc.marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('CURRENT', doc.marginLeft + 270, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('MIN', doc.marginLeft + 330, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('NEED', doc.marginLeft + 390, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('COST/UNIT', doc.marginLeft + 455, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('RESTOCK COST', doc.pageWidth - doc.marginRight - 6, yH, 7.5, true, [1, 1, 1]);
      doc.advanceY(22);
    };

    drawHeader();

    if (products.length === 0) {
      doc.drawText('All products are adequately stocked!', doc.marginLeft + 10, doc.getY(), 10, true, [0.02, 0.52, 0.35]);
    } else {
      products.forEach(p => {
        doc.ensureSpace(28, drawHeader);
        const y = doc.getY();
        const shopName = shopsById.get(p.shopId) || 'Shop';
        const needed = Math.max(0, p.minStock - p.currentStock);
        const restockCost = needed * (p.purchasePrice || 0);
        const isOut = p.currentStock <= 0;

        doc.drawText(truncate(p.name, 34), doc.marginLeft + 6, y, 8, true);
        doc.drawText(truncate(`${shopName} | ${p.sku}`, 38), doc.marginLeft + 6, y - 10, 6.8, false, [0.45, 0.5, 0.6]);
        doc.drawRightText(
          `${p.currentStock} ${p.unit}`,
          doc.marginLeft + 270,
          y,
          8,
          true,
          isOut ? [0.75, 0.15, 0.22] : [0.7, 0.38, 0.04]
        );
        doc.drawRightText(`${p.minStock} ${p.unit}`, doc.marginLeft + 330, y, 8);
        doc.drawRightText(String(needed), doc.marginLeft + 390, y, 8, true, [0.7, 0.38, 0.04]);
        doc.drawRightText(formatCurrency(p.purchasePrice || 0, cur), doc.marginLeft + 455, y, 7.8);
        doc.drawRightText(formatCurrency(restockCost, cur), doc.pageWidth - doc.marginRight - 6, y, 8, true, [0.75, 0.15, 0.22]);

        doc.advanceY(19);
        doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.4, [0.9, 0.92, 0.95]);
        doc.advanceY(5);
      });
    }

  const fileName = `low_stock_report_${new Date().toISOString().slice(0, 10)}.pdf`;
  return { doc, fileName };
}

export async function downloadLowStockReportPdf(
  products: Product[],
  shops: Shop[],
  settings: BusinessSettings,
  scopeLabel: string
): Promise<boolean> {
  try {
    const { doc, fileName } = buildLowStockReportDoc(products, shops, settings, scopeLabel);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadLowStockReportPdf failed:', err);
    return false;
  }
}

export async function printLowStockReportPdf(
  products: Product[],
  shops: Shop[],
  settings: BusinessSettings,
  scopeLabel: string
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildLowStockReportDoc(products, shops, settings, scopeLabel);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printLowStockReportPdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare low stock report for printing.' };
  }
}

function buildLossReportDoc(
  losses: InventoryMovement[],
  settings: BusinessSettings,
  meta: {
    periodLabel: string;
    totalLossValue: number;
    totalLossUnits: number;
  }
) {
  const doc = createPdfBuilder();
    const cur = settings.currencySymbol || 'TSh';

    doc.drawBanner(
      settings,
      'STOCK LOSS REPORT',
      `Period: ${meta.periodLabel}`,
      `Generated: ${new Date().toLocaleString()}`
    );

    const y0 = doc.getY();
    doc.drawRect(doc.marginLeft, y0 - 26, doc.contentWidth, 30, [0.99, 0.94, 0.94]);
    doc.drawText(`Loss Records: ${losses.length}`, doc.marginLeft + 10, y0 - 15, 8.5, true);
    doc.drawText(`Total Units Lost: ${meta.totalLossUnits}`, doc.marginLeft + 165, y0 - 15, 8.5, true, [0.7, 0.38, 0.04]);
    doc.drawRightText(
      `Total Loss Value: ${formatCurrency(meta.totalLossValue, cur)}`,
      doc.pageWidth - doc.marginRight - 10,
      y0 - 15,
      8.5,
      true,
      [0.75, 0.15, 0.22]
    );
    doc.advanceY(40);

    const drawHeader = () => {
      doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
      const yH = doc.getY() - 9;
      doc.drawText('DATE / USER', doc.marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
      doc.drawText('PRODUCT & REASON', doc.marginLeft + 125, yH, 7.5, true, [1, 1, 1]);
      doc.drawText('TYPE', doc.marginLeft + 340, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('QTY LOST', doc.marginLeft + 435, yH, 7.5, true, [1, 1, 1]);
      doc.drawRightText('LOSS VALUE', doc.pageWidth - doc.marginRight - 6, yH, 7.5, true, [1, 1, 1]);
      doc.advanceY(22);
    };

    drawHeader();

    losses.forEach(m => {
      doc.ensureSpace(28, drawHeader);
      const y = doc.getY();
      doc.drawText(truncate(formatDateTime(m.createdAt), 20), doc.marginLeft + 6, y, 7.8);
      doc.drawText(truncate(`By ${m.userName}`, 22), doc.marginLeft + 6, y - 10, 6.8, false, [0.45, 0.5, 0.6]);
      doc.drawText(truncate(m.productName, 34), doc.marginLeft + 125, y, 8, true);
      doc.drawText(truncate(m.reason || '-', 40), doc.marginLeft + 125, y - 10, 6.8, false, [0.4, 0.45, 0.55]);
      doc.drawText(m.type, doc.marginLeft + 340, y, 7.8, true, [0.75, 0.15, 0.22]);
      doc.drawRightText(String(Math.abs(m.changeQty)), doc.marginLeft + 435, y, 8, true);
      doc.drawRightText(
        formatCurrency(m.costValue || 0, cur),
        doc.pageWidth - doc.marginRight - 6,
        y,
        8,
        true,
        [0.75, 0.15, 0.22]
      );
      doc.advanceY(19);
      doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.4, [0.9, 0.92, 0.95]);
      doc.advanceY(5);
    });

  const fileName = `stock_loss_report_${meta.periodLabel.toLowerCase()}_${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
  return { doc, fileName };
}

export async function downloadLossReportPdf(
  losses: InventoryMovement[],
  settings: BusinessSettings,
  meta: {
    periodLabel: string;
    totalLossValue: number;
    totalLossUnits: number;
  }
): Promise<boolean> {
  try {
    const { doc, fileName } = buildLossReportDoc(losses, settings, meta);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadLossReportPdf failed:', err);
    return false;
  }
}

export async function printLossReportPdf(
  losses: InventoryMovement[],
  settings: BusinessSettings,
  meta: {
    periodLabel: string;
    totalLossValue: number;
    totalLossUnits: number;
  }
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildLossReportDoc(losses, settings, meta);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printLossReportPdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare loss report for printing.' };
  }
}

export interface PurchasesReportPdfMeta {
  shopLabel: string;
  periodKey: string;
  periodTitle: string;
  periodLabel: string;
  dateRangeText: string;
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  storeNameById?: Record<string, string>;
}

function buildPurchasesReportDoc(
  purchases: Purchase[],
  settings: BusinessSettings,
  meta: PurchasesReportPdfMeta
) {
  const doc = createPdfBuilder();
  const cur = settings.currencySymbol || 'TSh';

  const totalSpend = purchases.reduce((sum, p) => sum + (Number(p.totalAmount) || 0), 0);
  const totalUnits = purchases.reduce(
    (sum, p) => sum + (p.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0),
    0
  );

  doc.drawBanner(
    settings,
    meta.periodTitle || 'PURCHASES REPORT',
    `${meta.shopLabel} | ${meta.periodLabel}`,
    meta.searchQuery
      ? `Search: "${meta.searchQuery}" | Generated: ${new Date().toLocaleString()}`
      : `Range: ${meta.dateRangeText} | Generated: ${new Date().toLocaleString()}`
  );

  const y0 = doc.getY();
  doc.drawRect(doc.marginLeft, y0 - 28, doc.contentWidth, 32, [0.94, 0.96, 0.99]);
  doc.drawText(`Orders: ${purchases.length}`, doc.marginLeft + 10, y0 - 15, 8.5, true);
  doc.drawText(`Total Units: ${Number(totalUnits.toFixed(3))}`, doc.marginLeft + 135, y0 - 15, 8.5, true, [0.15, 0.38, 0.72]);
  doc.drawRightText(
    `Total Spend: ${formatCurrency(totalSpend, cur)}`,
    doc.pageWidth - doc.marginRight - 10,
    y0 - 15,
    8.5,
    true,
    [0.02, 0.52, 0.35]
  );
  doc.advanceY(42);

  const drawHeader = () => {
    doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
    const yH = doc.getY() - 9;
    doc.drawText('DATE / PO #', doc.marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
    doc.drawText('SUPPLIER & PHONE', doc.marginLeft + 105, yH, 7.5, true, [1, 1, 1]);
    doc.drawText('ITEMS & DESTINATION', doc.marginLeft + 250, yH, 7.5, true, [1, 1, 1]);
    doc.drawText('STATUS', doc.marginLeft + 410, yH, 7.5, true, [1, 1, 1]);
    doc.drawRightText('TOTAL', doc.pageWidth - doc.marginRight - 6, yH, 7.5, true, [1, 1, 1]);
    doc.advanceY(22);
  };

  drawHeader();

  if (purchases.length === 0) {
    doc.drawText('No purchase orders found for the selected filter.', doc.marginLeft + 10, doc.getY(), 9.5, false, [0.45, 0.5, 0.6]);
  } else {
    purchases.forEach(p => {
      doc.ensureSpace(32, drawHeader);
      const y = doc.getY();
      const dateStr = p.date || p.createdAt.slice(0, 10);
      const storeLabel = p.storeId
        ? `Store: ${p.storeName || meta.storeNameById?.[p.storeId] || 'Warehouse'}`
        : 'Shop Floor';
      const itemSummary = (p.items || [])
        .map(i => `${i.quantity}x ${i.productName}`)
        .join(', ');

      doc.drawText(truncate(dateStr, 14), doc.marginLeft + 6, y, 8, true);
      doc.drawText(truncate(p.purchaseNumber || '-', 18), doc.marginLeft + 6, y - 10, 6.8, false, [0.45, 0.5, 0.6]);

      doc.drawText(truncate(p.supplierName || 'Walk-in Supplier', 26), doc.marginLeft + 105, y, 8, true);
      doc.drawText(
        truncate(
          [p.supplierPhone, p.invoiceNumber ? `Inv: ${p.invoiceNumber}` : '']
            .filter(Boolean)
            .join(' | ') || '-',
          28
        ),
        doc.marginLeft + 105,
        y - 10,
        6.8,
        false,
        [0.45, 0.5, 0.6]
      );

      doc.drawText(
        truncate(`${(p.items || []).length} item(s) | ${storeLabel}`, 30),
        doc.marginLeft + 250,
        y,
        7.8,
        true
      );
      doc.drawText(truncate(itemSummary || '-', 32), doc.marginLeft + 250, y - 10, 6.8, false, [0.4, 0.45, 0.55]);

      doc.drawText(
        p.paymentStatus,
        doc.marginLeft + 410,
        y,
        7.5,
        true,
        p.paymentStatus === 'PAID' ? [0.02, 0.52, 0.35] : [0.7, 0.38, 0.04]
      );

      doc.drawRightText(
        formatCurrency(p.totalAmount, cur),
        doc.pageWidth - doc.marginRight - 6,
        y,
        8,
        true
      );

      doc.advanceY(20);
      doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.4, [0.9, 0.92, 0.95]);
      doc.advanceY(5);
    });
  }

  const cleanScope = (meta.shopLabel || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const fileName = `purchases_${meta.periodKey}_${cleanScope}_${new Date().toISOString().slice(0, 10)}.pdf`;
  return { doc, fileName };
}

export async function downloadPurchasesReportPdf(
  purchases: Purchase[],
  settings: BusinessSettings,
  meta: PurchasesReportPdfMeta
): Promise<boolean> {
  try {
    const { doc, fileName } = buildPurchasesReportDoc(purchases, settings, meta);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadPurchasesReportPdf failed:', err);
    return false;
  }
}

export async function printPurchasesReportPdf(
  purchases: Purchase[],
  settings: BusinessSettings,
  meta: PurchasesReportPdfMeta
): Promise<{ ok: boolean; mode?: 'print' | 'fallback_download'; error?: string }> {
  try {
    const { doc, fileName } = buildPurchasesReportDoc(purchases, settings, meta);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printPurchasesReportPdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare purchases report for printing.' };
  }
}

function buildSinglePurchaseVoucherDoc(
  purchase: Purchase,
  settings: BusinessSettings,
  resolvedStoreName?: string
) {
  const doc = createPdfBuilder();
  const cur = settings.currencySymbol || 'TSh';
  const dateStr = purchase.date || purchase.createdAt.slice(0, 10);
  const destinationLabel = purchase.storeId
    ? `Store Warehouse: ${resolvedStoreName || purchase.storeName || 'Warehouse'}`
    : 'Shop Floor';

  doc.drawBanner(
    settings,
    'PURCHASE VOUCHER',
    purchase.purchaseNumber || 'Stock In Order',
    `Date: ${dateStr} | Recorded: ${formatDateTime(purchase.createdAt)}`
  );

  const y0 = doc.getY();
  doc.drawRect(doc.marginLeft, y0 - 46, doc.contentWidth, 50, [0.95, 0.97, 0.99]);
  doc.drawText(`Supplier: ${purchase.supplierName || 'Walk-in Supplier'}`, doc.marginLeft + 10, y0 - 13, 9, true);
  doc.drawText(
    `Phone: ${purchase.supplierPhone || '-'}   |   Invoice #: ${purchase.invoiceNumber || '-'}`,
    doc.marginLeft + 10,
    y0 - 26,
    7.8,
    false,
    [0.35, 0.4, 0.5]
  );
  doc.drawText(
    `Destination: ${purchase.shopName || 'Shop'} (${destinationLabel})   |   Recorded By: ${purchase.createdByName}`,
    doc.marginLeft + 10,
    y0 - 38,
    7.5,
    false,
    [0.35, 0.4, 0.5]
  );

  doc.drawRightText(
    `Status: ${purchase.paymentStatus}`,
    doc.pageWidth - doc.marginRight - 10,
    y0 - 13,
    8.5,
    true,
    purchase.paymentStatus === 'PAID' ? [0.02, 0.52, 0.35] : [0.7, 0.38, 0.04]
  );
  doc.drawRightText(
    `Total: ${formatCurrency(purchase.totalAmount, cur)}`,
    doc.pageWidth - doc.marginRight - 10,
    y0 - 30,
    10,
    true
  );

  doc.advanceY(62);

  const drawHeader = () => {
    doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
    const yH = doc.getY() - 9;
    doc.drawText('#', doc.marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
    doc.drawText('PRODUCT NAME', doc.marginLeft + 26, yH, 7.5, true, [1, 1, 1]);
    doc.drawRightText('QTY', doc.marginLeft + 290, yH, 7.5, true, [1, 1, 1]);
    doc.drawRightText('BUY COST', doc.marginLeft + 380, yH, 7.5, true, [1, 1, 1]);
    doc.drawRightText('SELL PRICE', doc.marginLeft + 445, yH, 7.5, true, [1, 1, 1]);
    doc.drawRightText('SUBTOTAL', doc.pageWidth - doc.marginRight - 6, yH, 7.5, true, [1, 1, 1]);
    doc.advanceY(22);
  };

  drawHeader();

  (purchase.items || []).forEach((item, idx) => {
    doc.ensureSpace(24, drawHeader);
    const y = doc.getY();
    doc.drawText(String(idx + 1), doc.marginLeft + 6, y, 8);
    doc.drawText(truncate(item.productName, 40), doc.marginLeft + 26, y, 8.2, true);
    doc.drawRightText(String(item.quantity), doc.marginLeft + 290, y, 8, true);
    doc.drawRightText(formatCurrency(item.unitCost, cur), doc.marginLeft + 380, y, 8);
    doc.drawRightText(
      item.sellingPrice !== undefined && item.sellingPrice !== null
        ? formatCurrency(item.sellingPrice, cur)
        : '-',
      doc.marginLeft + 445,
      y,
      8
    );
    doc.drawRightText(formatCurrency(item.total, cur), doc.pageWidth - doc.marginRight - 6, y, 8.2, true);

    doc.advanceY(16);
    doc.drawLine(doc.marginLeft, doc.getY() + 3, doc.pageWidth - doc.marginRight, doc.getY() + 3, 0.4, [0.9, 0.92, 0.95]);
    doc.advanceY(5);
  });

  if (purchase.notes) {
    doc.ensureSpace(32);
    doc.advanceY(6);
    doc.drawText(`Notes: ${truncate(purchase.notes, 90)}`, doc.marginLeft + 6, doc.getY(), 8, false, [0.35, 0.4, 0.5]);
    doc.advanceY(16);
  }

  doc.ensureSpace(32);
  doc.advanceY(6);
  doc.drawRect(doc.marginLeft, doc.getY() - 18, doc.contentWidth, 24, [0.94, 0.96, 0.99]);
  const totalUnits = (purchase.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  doc.drawText(
    `Total Line Items: ${(purchase.items || []).length}  |  Total Units: ${Number(totalUnits.toFixed(3))}`,
    doc.marginLeft + 10,
    doc.getY() - 9,
    8.5,
    true
  );
  doc.drawRightText(
    `GRAND TOTAL: ${formatCurrency(purchase.totalAmount, cur)}`,
    doc.pageWidth - doc.marginRight - 10,
    doc.getY() - 9,
    9.5,
    true,
    [0.02, 0.52, 0.35]
  );

  const cleanNo = (purchase.purchaseNumber || purchase.id).replace(/[^a-zA-Z0-9_-]+/g, '_');
  const fileName = `purchase_${cleanNo}.pdf`;
  return { doc, fileName };
}

export async function downloadSinglePurchasePdf(
  purchase: Purchase,
  settings: BusinessSettings,
  resolvedStoreName?: string
): Promise<boolean> {
  try {
    const { doc, fileName } = buildSinglePurchaseVoucherDoc(purchase, settings, resolvedStoreName);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadSinglePurchasePdf failed:', err);
    return false;
  }
}

export async function printSinglePurchasePdf(
  purchase: Purchase,
  settings: BusinessSettings,
  resolvedStoreName?: string
): Promise<{ ok: boolean; mode?: 'print' | 'fallback_download'; error?: string }> {
  try {
    const { doc, fileName } = buildSinglePurchaseVoucherDoc(purchase, settings, resolvedStoreName);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printSinglePurchasePdf failed:', err);
    return { ok: false, error: err?.message || 'Failed to prepare purchase voucher for printing.' };
  }
}

export interface SoldProductSummaryRow {
  productName: string;
  totalRemained: number;
  totalSold?: number;
  unit?: string;
}

export interface SoldProductsSummaryPdfMeta {
  shopLabel: string;
  startDate?: string;
  endDate?: string;
  periodKey: string;
  periodLabel: string;
  dateRangeText: string;
  sellerLabel?: string;
  paymentLabel?: string;
  searchQuery?: string;
}

function buildSoldProductsSummaryDoc(
  rows: SoldProductSummaryRow[],
  settings: BusinessSettings,
  meta: SoldProductsSummaryPdfMeta
) {
  const doc = createPdfBuilder();

  doc.drawBanner(
    settings,
    'SOLD PRODUCTS SUMMARY',
    `${meta.shopLabel} | ${meta.periodLabel}`,
    `Dates: ${meta.dateRangeText}`
  );

  const totalRemainedUnits = rows.reduce((s, r) => s + (Number(r.totalRemained) || 0), 0);

  const y0 = doc.getY();
  doc.drawRect(doc.marginLeft, y0 - 40, doc.contentWidth, 44, [0.95, 0.97, 0.99]);
  doc.drawText(
    `Unique Sold Products: ${rows.length}`,
    doc.marginLeft + 10,
    y0 - 12,
    8.5,
    true,
    [0.12, 0.25, 0.5]
  );
  const filterLine = [
    meta.sellerLabel ? `Seller: ${meta.sellerLabel}` : null,
    meta.paymentLabel ? `Payment: ${meta.paymentLabel}` : null,
    meta.searchQuery ? `Search: "${meta.searchQuery}"` : null,
  ]
    .filter(Boolean)
    .join('  |  ');
  doc.drawText(
    truncate(filterLine || 'All Filters', 70),
    doc.marginLeft + 10,
    y0 - 26,
    7.8,
    false,
    [0.35, 0.4, 0.5]
  );
  doc.drawRightText(
    `Total Remained Qty: ${Number(totalRemainedUnits.toFixed(3)).toLocaleString()}`,
    doc.pageWidth - doc.marginRight - 10,
    y0 - 20,
    8.8,
    true,
    [0.15, 0.38, 0.72]
  );
  doc.advanceY(54);

  const remainedColDividerX = doc.marginLeft + 264;
  const remainedColTextX = remainedColDividerX + 10;
  const writeColDividerX = doc.marginLeft + 378;
  const tableRightX = doc.pageWidth - doc.marginRight;

  const drawHeader = () => {
    const headerTop = doc.getY() + 3;
    const headerBottom = doc.getY() - 15;
    doc.drawRect(doc.marginLeft, headerBottom, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
    doc.drawLine(remainedColDividerX, headerBottom, remainedColDividerX, headerTop, 0.6, [0.3, 0.36, 0.46]);
    doc.drawLine(writeColDividerX, headerBottom, writeColDividerX, headerTop, 0.6, [0.3, 0.36, 0.46]);
    const yH = doc.getY() - 9;
    doc.drawText('#', doc.marginLeft + 6, yH, 7.5, true, [1, 1, 1]);
    doc.drawText('PRODUCT NAME', doc.marginLeft + 28, yH, 7.5, true, [1, 1, 1]);
    doc.drawText('REMAINED QUANTITY', remainedColTextX, yH, 7.5, true, [1, 1, 1]);
    doc.advanceY(22);
  };

  drawHeader();

  if (rows.length === 0) {
    doc.drawText(
      'No sold products recorded for the selected period/filters.',
      doc.marginLeft + 10,
      doc.getY(),
      9,
      false,
      [0.45, 0.5, 0.6]
    );
  } else {
    const sortedRows = [...rows].sort((a, b) =>
      (a.productName || '').localeCompare(b.productName || '', undefined, { sensitivity: 'base' })
    );
    sortedRows.forEach((row, idx) => {
      doc.ensureSpace(22, drawHeader);
      const y = doc.getY();
      const rowTop = y + 9;
      const unitSuffix = row.unit ? ` ${row.unit}` : '';
      const remainedStr = `${Number((Number(row.totalRemained) || 0).toFixed(3))}${unitSuffix}`;

      doc.drawText(String(idx + 1), doc.marginLeft + 6, y, 8, false, [0.4, 0.45, 0.55]);
      doc.drawText(truncate(row.productName || 'Unnamed Product', 42), doc.marginLeft + 28, y, 8.2, true);
      doc.drawText(
        remainedStr,
        remainedColTextX,
        y,
        8.4,
        true,
        row.totalRemained <= 0 ? [0.75, 0.15, 0.22] : [0.15, 0.38, 0.72]
      );

      doc.advanceY(15);
      const rowBottom = doc.getY() + 3;
      doc.drawLine(
        remainedColDividerX,
        rowBottom,
        remainedColDividerX,
        rowTop,
        0.5,
        [0.86, 0.89, 0.93]
      );
      doc.drawLine(
        writeColDividerX,
        rowBottom,
        writeColDividerX,
        rowTop,
        0.5,
        [0.86, 0.89, 0.93]
      );
      doc.drawLine(
        tableRightX,
        rowBottom,
        tableRightX,
        rowTop,
        0.4,
        [0.88, 0.9, 0.94]
      );
      doc.drawLine(
        doc.marginLeft,
        rowBottom,
        tableRightX,
        rowBottom,
        0.5,
        [0.86, 0.89, 0.93]
      );
      doc.advanceY(5);
    });
  }

  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  const cleanShop = (meta.shopLabel || 'all').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const fileName = `sold_products_${meta.periodKey}_${cleanShop}_${dateTag}.pdf`;
  return { doc, fileName };
}

export async function downloadSoldProductsSummaryPdf(
  rows: SoldProductSummaryRow[],
  settings: BusinessSettings,
  meta: SoldProductsSummaryPdfMeta
): Promise<boolean> {
  try {
    const { doc, fileName } = buildSoldProductsSummaryDoc(rows, settings, meta);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadSoldProductsSummaryPdf failed:', err);
    return false;
  }
}

export async function printSoldProductsSummaryPdf(
  rows: SoldProductSummaryRow[],
  settings: BusinessSettings,
  meta: SoldProductsSummaryPdfMeta
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildSoldProductsSummaryDoc(rows, settings, meta);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printSoldProductsSummaryPdf failed:', err);
    return {
      ok: false,
      error: err?.message || 'Failed to prepare sold products summary for printing.',
    };
  }
}

export type AdjustmentReportPeriod = 'DAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

export interface AdjustmentPdfRow {
  createdAt: string;
  productName: string;
  sku?: string;
  locationLabel: string;
  shopName?: string;
  locationType: 'SHOP' | 'STORE';
  type: string;
  previousQty: number;
  changeQty: number;
  newQty: number;
  unit?: string;
  costValue: number;
  reason: string;
  userName: string;
}

export interface AdjustmentReportPdfMeta {
  period: AdjustmentReportPeriod;
  startDate: string;
  endDate: string;
  locationLabel: string;
  categoryLabel: string;
  directionLabel: string;
  searchQuery?: string;
  preparedBy?: string;
}

function buildAdjustmentsReportDoc(
  rows: AdjustmentPdfRow[],
  settings: BusinessSettings,
  meta: AdjustmentReportPdfMeta
) {
  const doc = createPdfBuilder();
  const cur = settings.currencySymbol || 'TSh';
  const periodTitle =
    meta.period === 'DAY'
      ? 'DAILY'
      : meta.period === 'WEEK'
        ? 'WEEKLY'
        : meta.period === 'MONTH'
          ? 'MONTHLY'
          : 'CUSTOM';
  const dateRangeText =
    meta.startDate === meta.endDate
      ? meta.startDate
      : `${meta.startDate || '...'} to ${meta.endDate || '...'}`;

  doc.drawBanner(
    settings,
    'STOCK ADJUSTMENTS REPORT',
    `${periodTitle} | ${meta.locationLabel}`,
    `Period: ${dateRangeText}`
  );

  const totalAdded = rows.reduce((s, r) => (r.changeQty > 0 ? s + r.changeQty : s), 0);
  const totalDeducted = rows.reduce(
    (s, r) => (r.changeQty < 0 ? s + Math.abs(r.changeQty) : s),
    0
  );
  const totalCost = rows.reduce((s, r) => s + (Number(r.costValue) || 0), 0);

  const y0 = doc.getY();
  doc.drawRect(doc.marginLeft, y0 - 44, doc.contentWidth, 48, [0.95, 0.97, 0.99]);
  doc.drawText(
    `Records: ${rows.length}   |   Added (+): +${totalAdded.toLocaleString()}   |   Deducted (-): -${totalDeducted.toLocaleString()}`,
    doc.marginLeft + 10,
    y0 - 13,
    8.5,
    true,
    [0.12, 0.25, 0.5]
  );
  const filterParts = [
    `Location: ${meta.locationLabel}`,
    `Category: ${meta.categoryLabel}`,
    `Direction: ${meta.directionLabel}`,
    meta.searchQuery ? `Search: "${meta.searchQuery}"` : null,
  ]
    .filter(Boolean)
    .join('  |  ');
  doc.drawText(
    truncate(filterParts, 78),
    doc.marginLeft + 10,
    y0 - 27,
    7.5,
    false,
    [0.35, 0.4, 0.5]
  );
  doc.drawText(
    truncate(`Prepared By: ${meta.preparedBy || 'Admin'}`, 45),
    doc.marginLeft + 10,
    y0 - 39,
    7.3,
    false,
    [0.45, 0.5, 0.6]
  );
  doc.drawRightText(
    `Total Cost Impact: ${formatCurrency(totalCost, cur)}`,
    doc.pageWidth - doc.marginRight - 10,
    y0 - 20,
    8.8,
    true,
    [0.42, 0.22, 0.65]
  );
  doc.advanceY(58);

  const drawHeader = () => {
    doc.drawRect(doc.marginLeft, doc.getY() - 15, doc.contentWidth, 18, [0.12, 0.16, 0.24]);
    const yH = doc.getY() - 9;
    doc.drawText('DATE / BY', doc.marginLeft + 6, yH, 7.2, true, [1, 1, 1]);
    doc.drawText('PRODUCT', doc.marginLeft + 92, yH, 7.2, true, [1, 1, 1]);
    doc.drawText('LOCATION', doc.marginLeft + 216, yH, 7.2, true, [1, 1, 1]);
    doc.drawText('TYPE', doc.marginLeft + 296, yH, 7.2, true, [1, 1, 1]);
    doc.drawText('BEFORE -> AFTER', doc.marginLeft + 356, yH, 7.2, true, [1, 1, 1]);
    doc.drawRightText('COST IMPACT', doc.pageWidth - doc.marginRight - 6, yH, 7.2, true, [1, 1, 1]);
    doc.advanceY(22);
  };

  drawHeader();

  if (rows.length === 0) {
    doc.drawText(
      'No stock adjustments matched the selected period and filters.',
      doc.marginLeft + 10,
      doc.getY(),
      9,
      false,
      [0.45, 0.5, 0.6]
    );
  } else {
    rows.forEach(row => {
      doc.ensureSpace(32, drawHeader);
      const y = doc.getY();
      const dateStr = formatDateTime(row.createdAt);
      const cleanReason =
        (row.reason || '').replace(/\s*\[[^\]]+\]\s*$/g, '').trim() || 'Stock adjustment';
      const deltaStr = row.changeQty > 0 ? `+${row.changeQty}` : `${row.changeQty}`;
      const qtyLine = `${row.previousQty} -> ${row.newQty} (${deltaStr})`;
      const isPositive = row.changeQty > 0;

      doc.drawText(truncate(dateStr, 17), doc.marginLeft + 6, y, 7.3, false, [0.35, 0.4, 0.5]);
      doc.drawText(truncate(row.userName || 'Staff', 17), doc.marginLeft + 6, y - 10, 7, false, [0.5, 0.55, 0.65]);

      doc.drawText(truncate(row.productName || 'Product', 24), doc.marginLeft + 92, y, 8, true);
      doc.drawText(truncate(cleanReason, 28), doc.marginLeft + 92, y - 10, 6.8, false, [0.45, 0.5, 0.6]);

      doc.drawText(truncate(row.locationLabel || 'Shop', 16), doc.marginLeft + 216, y, 7.6, true);
      if (row.locationType === 'STORE' && row.shopName) {
        doc.drawText(truncate(row.shopName, 16), doc.marginLeft + 216, y - 10, 6.8, false, [0.45, 0.5, 0.6]);
      } else {
        doc.drawText(row.locationType, doc.marginLeft + 216, y - 10, 6.8, false, [0.45, 0.5, 0.6]);
      }

      doc.drawText(truncate(row.type, 11), doc.marginLeft + 296, y, 7.4, true, [0.25, 0.3, 0.4]);
      doc.drawText(
        truncate(qtyLine, 20),
        doc.marginLeft + 356,
        y,
        7.8,
        true,
        isPositive ? [0.02, 0.52, 0.35] : [0.75, 0.15, 0.22]
      );
      doc.drawText(truncate(row.unit || 'pcs', 12), doc.marginLeft + 356, y - 10, 6.8, false, [0.45, 0.5, 0.6]);

      doc.drawRightText(
        formatCurrency(row.costValue || 0, cur),
        doc.pageWidth - doc.marginRight - 6,
        y,
        8,
        true
      );

      doc.advanceY(20);
      doc.drawLine(
        doc.marginLeft,
        doc.getY() + 3,
        doc.pageWidth - doc.marginRight,
        doc.getY() + 3,
        0.4,
        [0.9, 0.92, 0.95]
      );
      doc.advanceY(6);
    });
  }

  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  const fileName = `stock_adjustments_${meta.period.toLowerCase()}_${dateTag}.pdf`;
  return { doc, fileName };
}

export async function downloadAdjustmentsReportPdf(
  rows: AdjustmentPdfRow[],
  settings: BusinessSettings,
  meta: AdjustmentReportPdfMeta
): Promise<boolean> {
  try {
    const { doc, fileName } = buildAdjustmentsReportDoc(rows, settings, meta);
    return doc.download(fileName);
  } catch (err) {
    console.error('[pdfExport] downloadAdjustmentsReportPdf failed:', err);
    return false;
  }
}

export async function printAdjustmentsReportPdf(
  rows: AdjustmentPdfRow[],
  settings: BusinessSettings,
  meta: AdjustmentReportPdfMeta
): Promise<PdfPrintResult> {
  try {
    const { doc, fileName } = buildAdjustmentsReportDoc(rows, settings, meta);
    return await doc.print(fileName);
  } catch (err: any) {
    console.error('[pdfExport] printAdjustmentsReportPdf failed:', err);
    return {
      ok: false,
      error: err?.message || 'Failed to prepare stock adjustment report for printing.',
    };
  }
}
