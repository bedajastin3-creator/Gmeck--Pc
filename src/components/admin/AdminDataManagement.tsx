import React, { useState, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  FileSpreadsheet,
  Layers,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Cloud,
  Check,
  X,
  Code,
  AlertCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useApp } from '../../context/AppContext';
import { BackupService } from '../../services/backupService';
import { QuickBooksService } from '../../services/quickbooksService';
import { SyncService } from '../../services/syncService';
import { CsvDataService, ImportValidationResult } from '../../services/csvDataService';
import { ExcelImportService, ExcelParseResult } from '../../services/excelImportService';
import { ExcelExportService } from '../../services/excelExportService';
import { CsvDataType } from '../../types';
import { formatDateTime } from '../../utils/formatters';

type ExportFormat = 'xlsx' | 'csv';

export const AdminDataManagement: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();
  const [activeSubTab, setActiveSubTab] = useState<'csv' | 'backup' | 'quickbooks' | 'sync'>('csv');

  // CSV Data Center sub-states
  const [csvSection, setCsvSection] = useState<'export' | 'import' | 'templates' | 'history'>('export');
  const [selectedExportType, setSelectedExportType] = useState<CsvDataType>('PRODUCTS');
  const [selectedExportShopId, setSelectedExportShopId] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('xlsx');

  // CSV Import State
  const [importDataType, setImportDataType] = useState<CsvDataType>('PRODUCTS');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // EXCEL Import State
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelShopId, setExcelShopId] = useState<string>('');
  const [excelParseResult, setExcelParseResult] = useState<ExcelParseResult | null>(null);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  // QuickBooks Import state
  const [qbImportText, setQbImportText] = useState('');
  const [qbImportResult, setQbImportResult] = useState<any>(null);
  const [isProcessingQB, setIsProcessingQB] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [isWiping, setIsWiping] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  if (!currentUser || currentUser.role !== 'ADMIN') return null;

  const shops = dbState.shops || [];
  const importHistory = dbState.importHistory || [];

  // ─────────────────────────────────────────────────────────────
  // Non-Product export path (Sales, Purchases, Expenses, etc.)
  // ─────────────────────────────────────────────────────────────
  const handleExportData = () => {
    try {
      const { fileName: csvFileName, csvContent } =
        CsvDataService.exportDataToCsv(
          selectedExportType,
          selectedExportShopId || 'ALL'
        );

      if (!csvContent || csvContent.trim().length === 0) {
        addToast({
          type: 'warning',
          title: 'Nothing to export',
          description: `No ${selectedExportType.toLowerCase()} records found.`,
        });
        return;
      }

      if (exportFormat === 'csv') {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        triggerDownload(blob, csvFileName);

        addToast({
          type: 'success',
          title: 'CSV Export Generated',
          description: `Downloaded ${csvFileName}`,
        });
        return;
      }

      const rows = csvToRows(csvContent);
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      const colWidths = computeColWidths(rows);
      worksheet['!cols'] = colWidths.map(w => ({ wch: Math.min(w + 2, 40) }));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetNameFor(selectedExportType));

      const xlsxFileName = csvFileName.replace(/\.csv$/i, '.xlsx');
      XLSX.writeFile(workbook, xlsxFileName);

      addToast({
        type: 'success',
        title: 'Excel Export Generated',
        description: `Downloaded ${xlsxFileName}`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Export Failed',
        description: err.message || 'Could not generate file.',
      });
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Product Excel export — specific shop only
  // ─────────────────────────────────────────────────────────────
  const handleExportProductsExcel = () => {
    if (!selectedExportShopId) {
      addToast({
        type: 'warning',
        title: 'Select Shop First',
        description: 'Choose the shop you want to export products from.',
      });
      return;
    }

    const res = ExcelExportService.exportAllProducts(selectedExportShopId);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Export Ready',
        description: `${res.rowCount} products saved to ${res.fileName}`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Export Failed',
        description: res.error || 'Could not generate file.',
      });
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function csvToRows(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    let i = 0;

    while (i < csv.length) {
      const ch = csv[i];

      if (inQuotes) {
        if (ch === '"') {
          if (csv[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }

      if (ch === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      }

      if (ch === '\r') {
        i++;
        continue;
      }

      if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }

      field += ch;
      i++;
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  function computeColWidths(rows: string[][]): number[] {
    const widths: number[] = [];
    for (const row of rows) {
      row.forEach((cell, idx) => {
        const len = (cell ?? '').toString().length;
        widths[idx] = Math.max(widths[idx] || 0, len);
      });
    }
    return widths;
  }

  function sheetNameFor(type: CsvDataType): string {
    switch (type) {
      case 'PRODUCTS': return 'Products';
      case 'INVENTORY': return 'Inventory';
      case 'SALES': return 'Sales';
      case 'PURCHASES': return 'Purchases';
      case 'EXPENSES': return 'Expenses';
      case 'SELLERS': return 'Sellers';
      case 'SHOPS': return 'Shops';
      default: return 'Data';
    }
  }

  // Handle Download CSV Template
  const handleDownloadTemplate = (type: CsvDataType) => {
    const { fileName, csvContent } = CsvDataService.getCsvTemplate(type);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, fileName);

    addToast({
      type: 'info',
      title: 'Template Downloaded',
      description: `Downloaded template ${fileName}.`,
    });
  };

  // Handle CSV File Selection
  const handleCsvFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const text = event.target?.result as string;
        const validation = CsvDataService.validateCsv(importDataType, text, file.name);
        setValidationResult(validation);
      } catch (err: any) {
        addToast({
          type: 'error',
          title: 'CSV Read Error',
          description: err.message || 'Failed to parse file.',
        });
      }
    };
    reader.readAsText(file);
  };

  // Handle CSV Import Commit
  const handleCommitImport = async () => {
    if (!validationResult) return;
    setIsImporting(true);

    const res = await CsvDataService.commitImport(validationResult, currentUser);
    setIsImporting(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Import Successful',
        description: `Imported ${res.importedCount} records (${res.createdCount} created, ${res.updatedCount} updated).`,
      });
      setValidationResult(null);
      setUploadedFileName('');
      if (csvFileInputRef.current) csvFileInputRef.current.value = '';
    } else {
      addToast({
        type: 'error',
        title: 'Import Failed',
        description: res.error || 'Failed to commit import records.',
      });
    }
  };

  // Handle Export Backup
  const handleExportBackup = () => {
    BackupService.exportBackupFile(currentUser);
    addToast({
      type: 'success',
      title: 'Backup Generated',
      description: 'Full database snapshot exported.',
    });
  };

  // Handle Restore Backup
  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const content = event.target?.result as string;
        const res = BackupService.restoreFromBackupFile(content, currentUser);
        if (res.success) {
          addToast({
            type: 'success',
            title: 'Database Restored',
            description: 'All collections, shops, users, and transactions restored.',
          });
          window.location.reload();
        } else {
          addToast({
            type: 'error',
            title: 'Restore Failed',
            description: res.error || 'Invalid backup file structure.',
          });
        }
      } catch (err: any) {
        addToast({
          type: 'error',
          title: 'File Read Error',
          description: err.message,
        });
      }
    };
    reader.readAsText(file);
  };

  // Handle Wipe All Data
  const handleWipeAllData = () => {
    setIsWiping(true);
    const res = BackupService.wipeAllData(currentUser);
    setIsWiping(false);
    setShowWipeConfirm(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'All Demo & Business Data Deleted',
        description: 'The database has been cleanly purged.',
      });
      window.location.reload();
    } else {
      addToast({
        type: 'error',
        title: 'Action Failed',
        description: res.error || 'Failed to wipe data.',
      });
    }
  };

  // QuickBooks Import
  const handleLoadQBSample = () => {
    const sample = QuickBooksService.generateSampleIIF();
    setQbImportText(sample);
    setQbImportResult(null);
  };

  const handleExecuteQBImport = () => {
    if (!qbImportText.trim()) return;

    setIsProcessingQB(true);
    const result = QuickBooksService.parseAndImportIIF(qbImportText, currentUser);
    setIsProcessingQB(false);
    setQbImportResult(result);

    if (result.success) {
      addToast({
        type: 'success',
        title: 'QuickBooks Import Complete',
        description: `Imported ${result.itemsImported} products from QuickBooks export.`,
      });
    }
  };

  // Cloud Sync
  const handleSimulateSync = async () => {
    setIsSyncing(true);
    const result = await SyncService.processSyncQueue(currentUser, true);
    setIsSyncing(false);

    if (result.success) {
      addToast({
        type: 'success',
        title: 'Sync Successful',
        description: `Synchronized ${result.processedCount} local transactions with cloud.`,
      });
    }
  };

  const queueStats = SyncService.getSyncStats();

  return (
    <div id="admin-data-management-view" className="flex-1 p-6 bg-slate-950 text-slate-100 overflow-y-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Data Management & Excel Center</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Import products from Excel per shop, export datasets, audit import history, and manage local JSON backups
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportBackup}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            <Download className="w-4 h-4" />
            <span>Export Full JSON Backup</span>
          </button>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800">
        <button
          onClick={() => setActiveSubTab('csv')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeSubTab === 'csv'
              ? 'border-blue-500 text-blue-400 bg-slate-900/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Import / Export</span>
        </button>

        <button
          onClick={() => setActiveSubTab('backup')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeSubTab === 'backup'
              ? 'border-blue-500 text-blue-400 bg-slate-900/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>JSON Database Backup</span>
        </button>

        <button
          onClick={() => setActiveSubTab('quickbooks')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeSubTab === 'quickbooks'
              ? 'border-blue-500 text-blue-400 bg-slate-900/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Code className="w-4 h-4" />
          <span>QuickBooks .IIF</span>
        </button>

        <button
          onClick={() => setActiveSubTab('sync')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
            activeSubTab === 'sync'
              ? 'border-blue-500 text-blue-400 bg-slate-900/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cloud className="w-4 h-4" />
          <span>Sync Queue ({queueStats.pending})</span>
        </button>
      </div>

      {/* SUB-TAB 1: IMPORT/EXPORT CENTER */}
      {activeSubTab === 'csv' && (
        <div className="space-y-6">
          {/* Sub Navigation Bar */}
          <div className="flex items-center gap-2 bg-slate-900/80 p-1.5 rounded-lg border border-slate-800 w-fit">
            <button
              onClick={() => setCsvSection('import')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                csvSection === 'import' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📥 Import Excel
            </button>
            <button
              onClick={() => setCsvSection('export')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                csvSection === 'export' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📤 Export Data
            </button>
            <button
              onClick={() => setCsvSection('templates')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                csvSection === 'templates' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📋 CSV Templates
            </button>
            <button
              onClick={() => setCsvSection('history')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                csvSection === 'history' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📜 Import History ({importHistory.length})
            </button>
          </div>

          {/* 1. IMPORT EXCEL SECTION */}
          {csvSection === 'import' && (
            <div className="space-y-5">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    Import Products from Excel (.xlsx / .xls)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Select the target shop below, then upload an Excel file with columns:{' '}
                    <span className="text-slate-200 font-semibold">
                      Product Name, Buying Price, Selling Price, Quantity
                    </span>.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Target Shop <span className="text-rose-400">*</span>
                    </label>
                    <select
                      value={excelShopId}
                      onChange={e => {
                        setExcelShopId(e.target.value);
                        setExcelParseResult(null);
                        setExcelFile(null);
                        if (excelInputRef.current) excelInputRef.current.value = '';
                      }}
                      className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                    >
                      <option value="">-- Select a shop --</option>
                      {shops.map(sh => (
                        <option key={sh.id} value={sh.id}>
                          🏪 {sh.name} ({sh.code || 'UNIT'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Excel File (.xlsx / .xls) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      disabled={!excelShopId}
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        if (!excelShopId) {
                          addToast({
                            type: 'warning',
                            title: 'Select Shop First',
                            description: 'Please choose the target shop before uploading.',
                          });
                          return;
                        }

                        setExcelFile(file);
                        setIsParsingExcel(true);
                        const result = await ExcelImportService.parseExcelFile(file);
                        setIsParsingExcel(false);
                        setExcelParseResult(result);

                        if (result.errors.length > 0) {
                          addToast({
                            type: 'warning',
                            title: 'Validation Issues',
                            description: `${result.errors.length} issue(s) found. Review before committing.`,
                          });
                        } else if (result.rows.length > 0) {
                          addToast({
                            type: 'success',
                            title: 'Excel Parsed',
                            description: `${result.rows.length} product rows ready to import.`,
                          });
                        }
                      }}
                      className="w-full bg-slate-950 text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer p-1 rounded-lg border border-slate-800 disabled:opacity-40"
                    />
                    {!excelShopId && (
                      <p className="text-[11px] text-amber-400 mt-1">
                        ⚠ Select a shop above to enable file upload.
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-lg text-xs text-blue-200">
                  <strong>Excel Format:</strong>
                  <div className="mt-1 font-mono text-[11px] text-blue-100">
                    | Product Name | Buying Price | Selling Price | Quantity |
                  </div>
                </div>
              </div>

              {isParsingExcel && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-400 text-xs">
                  <RefreshCw className="w-5 h-5 mx-auto mb-2 animate-spin text-blue-400" />
                  Reading Excel file...
                </div>
              )}

              {excelParseResult && !isParsingExcel && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5 animate-in fade-in">
                  <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
                    <div>
                      <h4 className="font-bold text-sm text-white">Excel Validation Summary</h4>
                      <p className="text-xs text-slate-400">
                        File: {excelFile?.name} • Sheet: {excelParseResult.sheetName}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {excelParseResult.rows.length > 0 && (
                        <button
                          onClick={async () => {
                            if (!excelShopId) return;
                            setIsCommitting(true);
                            const res = await ExcelImportService.commitImport(
                              excelParseResult.rows,
                              excelShopId,
                              currentUser
                            );
                            setIsCommitting(false);

                            if (res.errors.length === 0) {
                              addToast({
                                type: 'success',
                                title: 'Import Successful',
                                description: `${res.created} created, ${res.updated} updated in ${
                                  shops.find(s => s.id === excelShopId)?.name
                                }.`,
                              });
                              setExcelParseResult(null);
                              setExcelFile(null);
                              if (excelInputRef.current) excelInputRef.current.value = '';
                            } else {
                              addToast({
                                type: 'error',
                                title: 'Import Completed with Errors',
                                description: `${res.created} created, ${res.updated} updated, ${res.errors.length} failed.`,
                              });
                            }
                          }}
                          disabled={isCommitting}
                          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-5 py-2.5 rounded-lg shadow-sm transition disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            {isCommitting
                              ? 'Importing...'
                              : `Confirm & Import to ${shops.find(s => s.id === excelShopId)?.name}`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">
                        Total Rows
                      </span>
                      <span className="text-sm font-bold text-slate-200">{excelParseResult.rows.length}</span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
                      <span className="text-[10px] text-emerald-400 uppercase tracking-wider block mb-1">
                        Ready to Import
                      </span>
                      <span className="text-sm font-bold text-emerald-400">
                        {excelParseResult.rows.length - excelParseResult.errors.length}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
                      <span className="text-[10px] text-rose-400 uppercase tracking-wider block mb-1">
                        Errors
                      </span>
                      <span className="text-sm font-bold text-rose-400">
                        {excelParseResult.errors.length}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
                      <span className="text-[10px] text-blue-400 uppercase tracking-wider block mb-1">
                        Target Shop
                      </span>
                      <span className="text-xs font-bold text-blue-300 truncate block">
                        {shops.find(s => s.id === excelShopId)?.name || '-'}
                      </span>
                    </div>
                  </div>

                  {excelParseResult.errors.length > 0 && (
                    <div className="p-4 bg-rose-950/20 border border-rose-800/40 rounded-lg space-y-2">
                      <h5 className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4" />
                        Errors ({excelParseResult.errors.length})
                      </h5>
                      <div className="max-h-40 overflow-y-auto space-y-1 text-xs text-rose-200">
                        {excelParseResult.errors.map((err, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="font-mono text-[10px] bg-rose-900/60 px-1.5 py-0.5 rounded">
                              Row {err.rowNumber}
                            </span>
                            <span className="break-words flex-1">{err.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {excelParseResult.rows.length > 0 && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-300 mb-2">
                        Preview first 10 rows
                      </h5>
                      <div className="overflow-x-auto border border-slate-800 rounded-lg">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-slate-950 text-slate-400 text-[11px]">
                            <tr>
                              <th className="p-2.5">Product Name</th>
                              <th className="p-2.5 text-right">Buying Price</th>
                              <th className="p-2.5 text-right">Selling Price</th>
                              <th className="p-2.5 text-right">Quantity</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {excelParseResult.rows.slice(0, 10).map((r, idx) => (
                              <tr key={idx} className="hover:bg-slate-800/40">
                                <td className="p-2.5 font-medium text-white">{r.productName}</td>
                                <td className="p-2.5 text-right font-mono text-slate-300">
                                  {r.buyingPrice.toLocaleString()}
                                </td>
                                <td className="p-2.5 text-right font-mono text-emerald-400 font-semibold">
                                  {r.sellingPrice.toLocaleString()}
                                </td>
                                <td className="p-2.5 text-right font-mono text-blue-300">
                                  {r.quantity}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {excelParseResult.rows.length > 10 && (
                        <p className="text-[11px] text-slate-500 mt-1.5">
                          ... and {excelParseResult.rows.length - 10} more rows
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 2. EXPORT SECTION */}
          {csvSection === 'export' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div>
                <h3 className="font-bold text-sm text-white">Export Dataset</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">File Format</label>
                  <select
                    value={exportFormat}
                    onChange={e => setExportFormat(e.target.value as ExportFormat)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="xlsx">📊 Excel (.xlsx)</option>
                    <option value="csv">📄 CSV (.csv)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Data Category</label>
                  <select
                    value={selectedExportType}
                    onChange={e => setSelectedExportType(e.target.value as CsvDataType)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="PRODUCTS">📦 Products</option>
                    <option value="INVENTORY">📊 Inventory (Stock Movements Log)</option>
                    <option value="SALES">🛒 Sales Transactions & Receipts</option>
                    <option value="PURCHASES">🚚 Purchases & Stock Invoices</option>
                    <option value="EXPENSES">📉 Operational Expenses</option>
                    <option value="SELLERS">👥 Sellers & Staff Accounts</option>
                    <option value="SHOPS">🏪 Shops & Business Units</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Target Shop <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={selectedExportShopId}
                    onChange={e => setSelectedExportShopId(e.target.value)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2 rounded-lg border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- Select a shop --</option>
                    {shops.map(sh => (
                      <option key={sh.id} value={sh.id}>
                        🏪 {sh.name} ({sh.code || 'UNIT'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Product Excel export — shop-scoped */}
              {exportFormat === 'xlsx' && selectedExportType === 'PRODUCTS' ? (
                <div className="pt-2">
                  <button
                    onClick={handleExportProductsExcel}
                    disabled={!selectedExportShopId}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-5 py-2.5 rounded-lg shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download PRODUCTS Excel</span>
                  </button>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    onClick={handleExportData}
                    disabled={!selectedExportShopId}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-5 py-2.5 rounded-lg shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      Download {selectedExportType} {exportFormat === 'xlsx' ? 'Excel' : 'CSV'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 3. CSV TEMPLATES SECTION */}
          {csvSection === 'templates' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div>
                <h3 className="font-bold text-sm text-white">Download Standard CSV Templates</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex flex-col justify-between">
                  <div>
                    <span className="text-xl mb-2 block">📦</span>
                    <h4 className="font-semibold text-xs text-white">Products Template</h4>
                  </div>
                  <button
                    onClick={() => handleDownloadTemplate('PRODUCTS')}
                    className="mt-4 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-medium transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .CSV</span>
                  </button>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex flex-col justify-between">
                  <div>
                    <span className="text-xl mb-2 block">🏪</span>
                    <h4 className="font-semibold text-xs text-white">Shops Template</h4>
                  </div>
                  <button
                    onClick={() => handleDownloadTemplate('SHOPS')}
                    className="mt-4 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-medium transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .CSV</span>
                  </button>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex flex-col justify-between">
                  <div>
                    <span className="text-xl mb-2 block">📉</span>
                    <h4 className="font-semibold text-xs text-white">Expenses Template</h4>
                  </div>
                  <button
                    onClick={() => handleDownloadTemplate('EXPENSES')}
                    className="mt-4 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-medium transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .CSV</span>
                  </button>
                </div>

                <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 flex flex-col justify-between">
                  <div>
                    <span className="text-xl mb-2 block">👥</span>
                    <h4 className="font-semibold text-xs text-white">Sellers Template</h4>
                  </div>
                  <button
                    onClick={() => handleDownloadTemplate('SELLERS')}
                    className="mt-4 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-medium transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .CSV</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 4. IMPORT HISTORY SECTION */}
          {csvSection === 'history' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div>
                <h3 className="font-bold text-sm text-white">Import Audit History</h3>
              </div>

              {importHistory.length > 0 ? (
                <div className="overflow-x-auto border border-slate-800 rounded-lg">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-950 text-slate-400 text-[11px]">
                      <tr>
                        <th className="p-3">Timestamp</th>
                        <th className="p-3">File Name</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Success / Total</th>
                        <th className="p-3">Created / Updated</th>
                        <th className="p-3">Imported By</th>
                        <th className="p-3">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {importHistory.map(item => (
                        <tr key={item.id} className="hover:bg-slate-800/40">
                          <td className="p-3 font-mono text-slate-400">{formatDateTime(item.createdAt)}</td>
                          <td className="p-3 font-semibold text-white">{item.fileName}</td>
                          <td className="p-3">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                              {item.dataType}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className="text-emerald-400 font-bold">{item.successCount}</span>
                            <span className="text-slate-500"> / {item.totalRecords}</span>
                          </td>
                          <td className="p-3 text-slate-300">
                            +{item.createdCount} / ⟳{item.updatedCount}
                          </td>
                          <td className="p-3 text-slate-300">{item.importedByName}</td>
                          <td className="p-3 text-slate-400 text-[11px]">{item.notes || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-950/40 rounded-lg border border-slate-800 text-slate-400 text-xs">
                  No imports recorded yet.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: JSON BACKUP / RESTORE */}
      {activeSubTab === 'backup' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-3 text-blue-400">
                <Download className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white">Export Full JSON Database Backup</h3>
              </div>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Export all multi-shop data, products, inventory movements, sales, purchases, expenses, and sellers into a portable .json backup file.
              </p>
              <button
                onClick={handleExportBackup}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition"
              >
                <Download className="w-4 h-4" />
                <span>Download .json Backup</span>
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-3 text-emerald-400">
                <Upload className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white">Restore Database Snapshot</h3>
              </div>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Restore the entire local database from a previously exported Gmeck Company Limited backup file.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleRestoreFile}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition"
              >
                <Upload className="w-4 h-4" />
                <span>Select .json Backup File</span>
              </button>
            </div>
          </div>

          <div className="bg-slate-900/90 border border-rose-900/40 rounded-2xl p-6 relative overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-rose-400 mb-1.5">
                  <AlertTriangle className="w-5 h-5" />
                  <h3 className="font-bold text-sm text-white">Production Clean Slate (Cloudflare Deployment Prep)</h3>
                </div>
                <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                  Permanently delete all demo and transaction records (products, sales, purchases, expenses, stock movements, debts, import history, and notifications).
                  Your system shop units and master Administrator account will remain active.
                </p>
              </div>

              <button
                onClick={() => setShowWipeConfirm(true)}
                className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 font-semibold text-xs transition"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Delete All Demo Data</span>
              </button>
            </div>
          </div>

          {showWipeConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-slate-900 border border-rose-800/60 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
                <div className="flex items-center gap-3 text-rose-400">
                  <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/50">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Delete All Demo & Transactional Data?</h4>
                    <p className="text-[11px] text-slate-400">This action cannot be undone.</p>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
                  <p className="text-rose-300 font-semibold">The following will be completely cleared:</p>
                  <ul className="list-disc pl-4 space-y-1 text-slate-400 text-[11px]">
                    <li>All products & catalog items</li>
                    <li>All sales transactions & receipts</li>
                    <li>All purchase orders & inventory stock movements</li>
                    <li>All shop & company expenses</li>
                    <li>All debts & customer credit records</li>
                    <li>All import logs & notifications</li>
                  </ul>
                  <p className="text-slate-400 text-[11px] pt-1">
                    Your Administrator account (<span className="text-white font-mono font-bold">Admin</span>) and Shop units will be preserved.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWipeConfirm(false)}
                    disabled={isWiping}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleWipeAllData}
                    disabled={isWiping}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg transition disabled:opacity-50"
                  >
                    {isWiping ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Purging Data...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Confirm & Delete All</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: QUICKBOOKS .IIF */}
      {activeSubTab === 'quickbooks' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-white">QuickBooks IIF Product Importer</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Paste raw QuickBooks Item List (.IIF) text to import inventory products
              </p>
            </div>
            <button
              onClick={handleLoadQBSample}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
            >
              Load Sample IIF Data
            </button>
          </div>

          <textarea
            rows={8}
            value={qbImportText}
            onChange={e => setQbImportText(e.target.value)}
            placeholder="Paste raw QuickBooks .IIF export text here..."
            className="w-full bg-slate-950 font-mono text-xs text-slate-200 p-3 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
          />

          <button
            onClick={handleExecuteQBImport}
            disabled={isProcessingQB || !qbImportText.trim()}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow transition disabled:opacity-50"
          >
            {isProcessingQB ? 'Processing IIF...' : 'Import Products from IIF'}
          </button>

          {qbImportResult && (
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300">
              <span className="font-bold text-emerald-400">Result:</span> Imported {qbImportResult.itemsImported} products.
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: SYNC QUEUE */}
      {activeSubTab === 'sync' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-white">Offline Synchronization Queue</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Local transactions waiting for cloud gateway synchronization
              </p>
            </div>
            <button
              onClick={handleSimulateSync}
              disabled={isSyncing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Sync with Cloud</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Pending Records</span>
              <span className="text-sm font-bold text-amber-400">{queueStats.pending}</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Synced Records</span>
              <span className="text-sm font-bold text-emerald-400">{queueStats.synced}</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Total Queue Logs</span>
              <span className="text-sm font-bold text-slate-200">{queueStats.total}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
