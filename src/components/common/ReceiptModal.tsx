import React, { useRef } from 'react';
import { Printer, Download, Copy, X, Check, Store } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

export const ReceiptModal: React.FC = () => {
  const { activeReceipt, closeReceipt, dbState, addToast } = useApp();
  const [copied, setCopied] = React.useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  if (!activeReceipt) return null;

  const settings = dbState.settings;

  const handlePrint = () => {
    window.print();
  };

  const generateReceiptPlainText = () => {
    let text = `========================================\n`;
    text += `       ${settings.businessName}\n`;
    text += `   ${settings.tagline}\n`;
    text += `   ${settings.address}\n`;
    text += `   Phone: ${settings.phone}\n`;
    text += `========================================\n`;
    text += `Receipt #: ${activeReceipt.receiptNumber}\n`;
    text += `Date/Time: ${formatDateTime(activeReceipt.createdAt)}\n`;
    text += `Cashier  : ${activeReceipt.sellerName}\n`;
    text += `Status   : ${activeReceipt.status}\n`;
    text += `----------------------------------------\n`;
    text += `ITEMS                  QTY   PRICE   TOTAL\n`;
    text += `----------------------------------------\n`;
    (activeReceipt.items || []).forEach(item => {
      text += `${(item.productName || '').slice(0, 20).padEnd(20)} ${(item.quantity || 0).toString().padStart(3)}  ${formatCurrency(item.unitPrice || 0, settings.currencySymbol).padStart(6)}  ${formatCurrency(item.total || 0, settings.currencySymbol).padStart(7)}\n`;
    });
    text += `----------------------------------------\n`;
    text += `Subtotal:             ${formatCurrency(activeReceipt.subtotal, settings.currencySymbol)}\n`;
    if (activeReceipt.discount > 0) {
      text += `Discount:            -${formatCurrency(activeReceipt.discount, settings.currencySymbol)}\n`;
    }
    text += `TOTAL:                ${formatCurrency(activeReceipt.total, settings.currencySymbol)}\n`;
    text += `Payment:              ${activeReceipt.paymentMethod}\n`;
    text += `Tendered:             ${formatCurrency(activeReceipt.amountReceived, settings.currencySymbol)}\n`;
    text += `Change:               ${formatCurrency(activeReceipt.change, settings.currencySymbol)}\n`;
    text += `========================================\n`;
    text += `  ${settings.receiptFooterNote}\n`;
    text += `========================================\n`;
    return text;
  };

  const handleCopy = () => {
    const text = generateReceiptPlainText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    addToast({
      type: 'success',
      title: 'Receipt Copied',
      description: 'Receipt text copied to clipboard.',
    });
  };

  const handleDownload = () => {
    const text = generateReceiptPlainText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeReceipt.receiptNumber}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({
      type: 'success',
      title: 'Receipt Downloaded',
      description: `Saved as ${activeReceipt.receiptNumber}.txt`,
    });
  };

  return (
    <div id="receipt-modal-backdrop" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Commercial POS Receipt</h3>
          </div>
          <button
            id="close-receipt-modal"
            onClick={closeReceipt}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Thermal Receipt Paper Canvas */}
        <div className="p-6 bg-slate-950 flex justify-center">
          <div
            ref={printRef}
            id="printable-receipt-card"
            className="w-full max-w-[340px] bg-white text-slate-900 p-5 rounded shadow-lg font-mono text-xs leading-relaxed border-t-4 border-slate-800"
          >
            {/* Store Header */}
            <div className="text-center pb-3 border-b border-dashed border-slate-300">
              <h2 className="text-base font-bold tracking-tight text-slate-950 uppercase">{settings.businessName}</h2>
              <p className="text-[11px] text-slate-600 font-sans mt-0.5">{settings.tagline}</p>
              <p className="text-[10px] text-slate-500 font-sans mt-1">{settings.address}</p>
              <p className="text-[10px] text-slate-500 font-sans">Tel: {settings.phone}</p>
            </div>

            {/* Transaction Metadata */}
            <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Receipt #:</span>
                <span className="font-bold text-slate-900">{activeReceipt.receiptNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date:</span>
                <span>{formatDateTime(activeReceipt.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Seller:</span>
                <span className="font-medium">{activeReceipt.sellerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status:</span>
                <span className={`font-bold ${activeReceipt.status === 'COMPLETED' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {activeReceipt.status}
                </span>
              </div>
              {activeReceipt.voidReason && (
                <div className="text-[10px] bg-rose-50 text-rose-800 p-1.5 rounded border border-rose-200 mt-1">
                  Void Reason: {activeReceipt.voidReason}
                </div>
              )}
            </div>

            {/* Line Items Table */}
            <div className="py-3 border-b border-dashed border-slate-300">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="pb-1 font-semibold">Item</th>
                    <th className="pb-1 text-center font-semibold">Qty</th>
                    <th className="pb-1 text-right font-semibold">Price</th>
                    <th className="pb-1 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(activeReceipt.items || []).map(item => (
                    <tr key={item.id} className="py-1">
                      <td className="py-1 pr-1 font-sans">
                        <div className="font-medium text-slate-900 leading-tight">{item.productName}</div>
                        <div className="text-[9px] text-slate-400 font-mono">{item.sku}</div>
                      </td>
                      <td className="py-1 text-center font-mono">{item.quantity}</td>
                      <td className="py-1 text-right font-mono text-slate-600">
                        {formatCurrency(item.unitPrice, settings.currencySymbol)}
                      </td>
                      <td className="py-1 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(item.total, settings.currencySymbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals & Payments */}
            <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1 text-[11px]">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>{formatCurrency(activeReceipt.subtotal, settings.currencySymbol)}</span>
              </div>
              {activeReceipt.discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount</span>
                  <span>-{formatCurrency(activeReceipt.discount, settings.currencySymbol)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-extrabold text-slate-950 pt-1 border-t border-slate-200">
                <span>TOTAL DUE</span>
                <span>{formatCurrency(activeReceipt.total, settings.currencySymbol)}</span>
              </div>
              <div className="flex justify-between text-slate-700 pt-1">
                <span>Payment Method</span>
                <span className="font-semibold">{activeReceipt.paymentMethod}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Amount Tendered</span>
                <span>{formatCurrency(activeReceipt.amountReceived, settings.currencySymbol)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900">
                <span>Change Returned</span>
                <span>{formatCurrency(activeReceipt.change, settings.currencySymbol)}</span>
              </div>
            </div>

            {/* Footer Policy Notes */}
            <div className="text-center pt-3 text-[10px] text-slate-500 font-sans leading-tight">
              <p className="font-medium text-slate-700">{settings.receiptHeaderNote}</p>
              <p className="mt-1">{settings.receiptFooterNote}</p>
              <div className="mt-3 font-mono text-[9px] text-slate-400 tracking-widest">
                *** THANK YOU FOR YOUR BUSINESS ***
              </div>
            </div>
          </div>
        </div>

        {/* Modal Action Controls */}
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              id="copy-receipt-btn"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Text'}</span>
            </button>
            <button
              id="download-receipt-btn"
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save .txt</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="print-receipt-btn"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow transition"
            >
              <Printer className="w-4 h-4" />
              <span>Print Receipt</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
