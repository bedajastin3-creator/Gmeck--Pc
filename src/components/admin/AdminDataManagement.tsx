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
  Code,
  AlertCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useApp } from '../../context/AppContext';
import { BackupService } from '../../services/backupService';
import { QuickBooksService } from '../../services/quickbooksService';
import { SyncService } from '../../services/syncService';
import { CsvDataService, ImportValidationResult } from '../../services/csvDataService';
import {
  ExcelImportService,
  ExcelParseResult,
  ImportProgressInfo,
} from '../../services/excelImportService';
import { ImportProgressBar } from '../common/ImportProgressBar';
import { ExcelExportService } from '../../services/excelExportService';
import { CsvDataType } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { saveTextFileCrossPlatform } from '../../utils/nativeDownload';
import { getAdminManagedShops, isPlatformAdmin, isShopAdmin } from '../../utils/permissions';

type ExportFormat = 'xlsx' | 'csv';

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
    case 'PRODUCTS':
      return 'Products';
    case 'INVENTORY':
      return 'Inventory';
    case 'SALES':
      return 'Sales';
    case 'PURCHASES':
      return 'Purchases';
    case 'EXPENSES':
      return 'Expenses';
    case 'SELLERS':
      return 'Sellers';
    case 'SHOPS':
      return 'Shops';
    default:
      return 'Data';
  }
}

export const AdminDataManagement: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();
  const [activeSubTab, setActiveSubTab] = useState<'csv' | 'backup' | 'quickbooks' | 'sync'>('csv');

  // Sub-tab state
  const [csvSection, setCsvSection] = useState<'import' | 'export' | 'templates' | 'history'>('import');
  const [selectedExportType, setSelectedExportType] = useState<CsvDataType>('PRODUCTS');
  const [selectedExportShopId, setSelectedExportShopId] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('xlsx');

  // CSV Import State (kept in sync with CsvDataService)
  const [importDataType] = useState<CsvDataType>('PRODUCTS');
  const [, setUploadedFileName] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ImportValidationResult | null>(null);
  const [, setIsImporting] = useState(false);

  // SIMPLE EXCEL IMPORT STATE (4 Columns: Product Name, Buying Price, Selling Price, Quantity)
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelShopId, setExcelShopId] = useState<string>('');
  const [excelParseResult, setExcelParseResult] = useState<ExcelParseResult | null>(null);
  const [isParsingExcel, setIsParsingExcel] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [excelProgress, setExcelProgress] = useState<ImportProgressInfo | null>(null);

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

  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);

  if (!currentUser || (!platformAdmin && !shopAdmin)) return null;

  const shops = platformAdmin
    ? dbState.shops || []
    : getAdminManagedShops(currentUser, dbState.shops || []);
  const importHistory = dbState.importHistory || [];

  // Auto-default shop selection if a Shop Admin only manages a single shop
  const effectiveExcelShopId =
    excelShopId && shops.some(s => s.id === excelShopId)
      ? excelShopId
      : !platformAdmin && shops.length === 1
      ? shops[0].id
      : '';
  const effectiveExportShopId =
    selectedExportShopId && shops.some(s => s.id === selectedExportShopId)
      ? selectedExportShopId
      : !platformAdmin && shops.length === 1
      ? shops[0].id
      : '';

  // ==============================
  // EXCEL IMPORT HANDLERS
  // ==============================
  const handleExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!effectiveExcelShopId) {
      addToast({
        type: 'warning',
        title: 'Select Shop First',
        description: 'Please choose which shop should receive these imported products.',
      });
      if (excelInputRef.current) excelInputRef.current.value = '';
      return;
    }

    setExcelFile(file);
    setExcelParseResult(null);
    setIsParsingExcel(true);
    setExcelProgress({
      stage: 'READING',
      percent: 2,
      processedRows: 0,
      totalRows: 0,
      message: `Opening "${file.name}"...`,
    });

    try {
      const result = await ExcelImportService.parseExcelFile(file, progress => {
        setExcelProgress(progress);
      });
      setExcelParseResult(result);

      if (result.errors.length > 0 && result.rows.length === 0) {
        addToast({
          type: 'error',
          title: 'Invalid Excel Format',
          description: result.errors[0]?.message || 'Could not read products from file.',
        });
      } else if (result.errors.length > 0) {
        addToast({
          type: 'warning',
          title: 'Validation Issues',
          description: `${result.rows.length.toLocaleString()} valid rows found, ${result.errors.length.toLocaleString()} row(s) had issues.`,
        });
      } else {
        addToast({
          type: 'success',
          title: 'File Ready to Import',
          description: `${result.rows.length.toLocaleString()} products parsed from ${file.name}.`,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Failed to Read File',
        description: err?.message || 'Unexpected error while reading spreadsheet.',
      });
    } finally {
      setIsParsingExcel(false);
    }
  };

  const handleCommitExcelImport = async () => {
    if (!excelParseResult || excelParseResult.rows.length === 0) return;

    const selectedShop = shops.find(s => s.id === effectiveExcelShopId);
    if (!effectiveExcelShopId || !selectedShop) {
      addToast({
        type: 'warning',
        title: 'Select Shop First',
        description: 'Please select a target shop before confirming import.',
      });
      return;
    }

    setIsCommitting(true);
    setExcelProgress({
      stage: 'SAVING',
      percent: 2,
      processedRows: 0,
      totalRows: excelParseResult.rows.length,
      message: `Starting import of ${excelParseResult.rows.length.toLocaleString()} products...`,
    });

    try {
      const res = await ExcelImportService.commitImportAsync(
        excelParseResult.rows,
        effectiveExcelShopId,
        currentUser,
        undefined,
        progress => {
          setExcelProgress(progress);
        }
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Import Successful',
          description: `${res.created.toLocaleString()} created, ${res.updated.toLocaleString()} updated in ${selectedShop.name}.`,
        });
        setExcelParseResult(null);
        setExcelFile(null);
        setExcelProgress(null);
        if (excelInputRef.current) excelInputRef.current.value = '';
      } else {
        addToast({
          type: 'error',
          title: 'Import Completed with Errors',
          description: `${res.created.toLocaleString()} created, ${res.updated.toLocaleString()} updated, ${res.errors.length.toLocaleString()} error(s).`,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Import Failed',
        description: err?.message || 'Unexpected error while saving products.',
      });
    } finally {
      setIsCommitting(false);
    }
  };

  // ==============================
  // EXPORT HANDLERS
  // ==============================
  const handleExportDataset = async () => {
    try {
      const { fileName: csvFileName, csvContent } = CsvDataService.exportDataToCsv(
        selectedExportType,
        effectiveExportShopId || 'ALL'
      );

      if (!csvContent || csvContent.trim().length === 0) {
        addToast({
          type: 'warning',
          title: 'Nothing to Export',
          description: `No ${selectedExportType.toLowerCase()} records found.`,
        });
        return;
      }

      if (exportFormat === 'csv') {
        const res = await saveTextFileCrossPlatform(
          csvContent,
          csvFileName,
          'text/csv;charset=utf-8;'
        );
        addToast(
          res.ok
            ? {
                type: 'success',
                title: 'CSV Export Generated',
                description: `Saved ${csvFileName}.`,
              }
            : {
                type: 'error',
                title: 'Export Failed',
                description: res.error || 'Could not save CSV file.',
              }
        );
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
        description: err?.message || 'Could not generate file.',
      });
    }
  };

  const handleExportProductsExcel = () => {
    if (!effectiveExportShopId) {
      addToast({
        type: 'warning',
        title: 'Select Shop First',
        description: 'Choose the shop you want to export products from.',
      });
      return;
    }

    const res = ExcelExportService.exportAllProducts(effectiveExportShopId);

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

  // ==============================
  // CSV HANDLERS
  // ==============================
  const handleDownloadTemplate = async (type: CsvDataType) => {
    const { fileName, csvContent } = CsvDataService.getCsvTemplate(type);
    const res = await saveTextFileCrossPlatform(csvContent, fileName, 'text/csv;charset=utf-8;');
    addToast(
      res.ok
        ? {
            type: 'info',
            title: 'Template Downloaded',
            description: `Saved ${fileName}.`,
          }
        : {
            type: 'error',
            title: 'Download Failed',
            description: res.error || 'Could not save template file.',
          }
    );
  };

  const _handleCsvFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    try {
      const text = await file.text();
      const validation = await CsvDataService.validateCsvAsync(
        importDataType,
        text,
        file.name,
        p => setExcelProgress(p)
      );
      setValidationResult(validation);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'CSV Read Error',
        description: err.message || 'Failed to parse file.',
      });
    }
  };

  const _handleCommitImport = async () => {
    if (!validationResult) return;
    setIsImporting(true);

    try {
      const res = await CsvDataService.commitImport(validationResult, currentUser, p =>
        setExcelProgress(p)
      );
      if (res.success) {
        addToast({
          type: 'success',
          title: 'Import Successful',
          description: `Imported ${res.importedCount.toLocaleString()} records.`,
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
    } finally {
      setIsImporting(false);
    }
  };

  void _handleCsvFileSelected;
  void _handleCommitImport;

  // ==============================
  // BACKUP HANDLERS
  // ==============================
  const handleExportBackup = () => {
    BackupService.exportBackupFile(currentUser);
    addToast({
      type: 'success',
      title: 'Backup Generated',
      description: 'Full database snapshot exported.',
    });
  };

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
            description: 'All data restored successfully.',
          });
          window.location.reload();
        } else {
          addToast({
            type: 'error',
            title: 'Restore Failed',
            description: res.error || 'Invalid backup file.',
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

  const handleWipeAllData = () => {
    setIsWiping(true);
    const res = BackupService.wipeAllData(currentUser);
    setIsWiping(false);
    setShowWipeConfirm(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'All Data Deleted',
        description: 'Database cleanly purged.',
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

  // ==============================
  // QUICKBOOKS HANDLERS
  // ==============================
  const handleLoadQBSample = () => {
    const sample = QuickBooksService.generateSampleIIF();
    setQbImportText(sample);
    setQbImportResult(null);
  };

  const handleExecuteQBImport = async () => {
    if (!qbImportText.trim()) return;

    setIsProcessingQB(true);
    const result = await QuickBooksService.parseAndImportIIF(qbImportText, currentUser);
    setIsProcessingQB(false);
    setQbImportResult(result);

    if (result.success) {
      addToast({
        type: 'success',
        title: 'QuickBooks Import Complete',
        description: `Imported ${result.itemsImported} products to cloud database.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'QuickBooks Import Failed',
        description: result.error || 'Could not import QuickBooks products.',
      });
    }
  };

  // ==============================
  // SYNC HANDLER
  // ==============================
  const handleSimulateSync = async () => {
    setIsSyncing(true);
    const result = await SyncService.processSyncQueue(currentUser, true);
    setIsSyncing(false);

    if (result.success) {
      addToast({
        type: 'success',
        title: 'Cloud Refresh Successful',
        description: result.message || 'Live data refreshed from cloud database.',
      });
    } else {
      addToast({
        type: 'error',
        title: 'Offline',
        description: result.message || 'You are offline. Wait for internet connection.',
      });
    }
  };

  const queueStats = SyncService.getSyncStats();

  return (
    <div
      id="admin-data-management-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto space-y-4 sm:space-y-6 pb-24 sm:pb-6"
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3.5 sm:pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 sm:w-6 sm:h-6 text-lime-400" />
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              Shop Import &amp; Export
            </h2>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
            {platformAdmin
              ? 'Upload products from Excel, export CSV/Excel datasets, and manage backups'
              : 'Upload products from Excel and export datasets for your managed shop'}
          </p>
        </div>

        {platformAdmin && (
          <button
            onClick={handleExportBackup}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 sm:py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-xs font-semibold border border-slate-700 transition shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>Export JSON Backup</span>
          </button>
        )}
      </div>

      {/* Main Navigation Tabs */}
      {platformAdmin && (
        <div className="flex items-center gap-1 sm:gap-2 border-b border-slate-800 overflow-x-auto pb-px">
          <button
            onClick={() => setActiveSubTab('csv')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
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
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
              activeSubTab === 'backup'
                ? 'border-blue-500 text-blue-400 bg-slate-900/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>JSON Backup</span>
          </button>

          <button
            onClick={() => setActiveSubTab('quickbooks')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
              activeSubTab === 'quickbooks'
                ? 'border-blue-500 text-blue-400 bg-slate-900/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code className="w-4 h-4" />
            <span>QuickBooks</span>
          </button>

          <button
            onClick={() => setActiveSubTab('sync')}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
              activeSubTab === 'sync'
                ? 'border-blue-500 text-blue-400 bg-slate-900/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cloud className="w-4 h-4" />
            <span>Cloud Sync</span>
          </button>
        </div>
      )}

      {/* SUB-TAB 1: CSV / EXCEL DATA MANAGEMENT */}
      {activeSubTab === 'csv' && (
        <div className="space-y-4 sm:space-y-5">
          {/* Sub Navigation Bar */}
          <div className="flex items-center gap-1.5 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800 overflow-x-auto sm:w-fit">
            <button
              onClick={() => setCsvSection('import')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                csvSection === 'import'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📥 Import Excel
            </button>
            <button
              onClick={() => setCsvSection('export')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                csvSection === 'export'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📤 Export Data
            </button>
            <button
              onClick={() => setCsvSection('templates')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                csvSection === 'templates'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📋 Templates
            </button>
            <button
              onClick={() => setCsvSection('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                csvSection === 'history'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📜 History ({importHistory.length})
            </button>
          </div>

          {/* 1. IMPORT EXCEL SECTION */}
          {csvSection === 'import' && (
            <div className="space-y-4 sm:space-y-5">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-5">
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                    Import Products from Excel (.xlsx / .xls / .csv)
                  </h3>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-1">
                    Upload an Excel file (.xlsx / .xls / .csv) with Product Name, Buying Price, Selling Price, and Quantity
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 max-w-2xl">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Target Shop <span className="text-rose-400">*</span>
                    </label>
                    <select
                      value={effectiveExcelShopId}
                      disabled={isParsingExcel || isCommitting}
                      onChange={e => {
                        setExcelShopId(e.target.value);
                        setExcelParseResult(null);
                        setExcelFile(null);
                        setExcelProgress(null);
                        if (excelInputRef.current) excelInputRef.current.value = '';
                      }}
                      className="w-full bg-slate-950 text-xs text-white px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500 disabled:opacity-50"
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
                      Excel File (.xlsx / .xls / .csv) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      disabled={!effectiveExcelShopId || isParsingExcel || isCommitting}
                      onChange={handleExcelFileSelected}
                      className="w-full bg-slate-950 text-xs text-slate-300 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer p-1.5 rounded-xl border border-slate-800 disabled:opacity-40"
                    />
                    {!effectiveExcelShopId && (
                      <p className="text-[10px] sm:text-[11px] text-amber-400 mt-1">
                        ⚠ Select a shop above to enable upload
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl text-[11px] sm:text-xs text-blue-200">
                  <strong>Expected Excel Columns:</strong>
                  <div className="mt-1 font-mono text-[10px] sm:text-[11px] text-blue-100 overflow-x-auto whitespace-nowrap">
                    Product Name | Buying Price | Selling Price | Quantity
                  </div>
                </div>
              </div>

              {(isParsingExcel || isCommitting) && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5">
                  <ImportProgressBar
                    progress={excelProgress}
                    phaseLabel={isCommitting ? 'Importing Products' : undefined}
                  />
                </div>
              )}

              {excelParseResult && !isParsingExcel && (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                    <div>
                      <h4 className="font-bold text-sm text-white">Preview &amp; Validation</h4>
                      <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                        {excelFile?.name || 'Spreadsheet'} • {excelParseResult.sheetName || 'Sheet1'}
                      </p>
                    </div>
                    {effectiveExcelShopId && (
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">
                        Shop: {shops.find(s => s.id === effectiveExcelShopId)?.name}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Total Rows</span>
                      <span className="text-base font-bold text-slate-200 font-mono tabular-nums">
                        {(excelParseResult.rows.length + excelParseResult.errors.length).toLocaleString()}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Valid Rows</span>
                      <span className="text-base font-bold text-emerald-400 font-mono tabular-nums">
                        {excelParseResult.rows.length.toLocaleString()}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Errors</span>
                      <span className="text-base font-bold text-rose-400 font-mono tabular-nums">
                        {excelParseResult.errors.length.toLocaleString()}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
                      <span className="text-[10px] text-slate-400 uppercase block">Target Shop</span>
                      <span className="text-xs font-bold text-blue-300 truncate block mt-1">
                        {shops.find(s => s.id === effectiveExcelShopId)?.name || '-'}
                      </span>
                    </div>
                  </div>

                  {excelParseResult.errors.length > 0 && (
                    <div className="p-3 sm:p-4 bg-rose-950/20 border border-rose-800/40 rounded-xl space-y-2">
                      <h5 className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4" />
                        Errors ({excelParseResult.errors.length.toLocaleString()})
                      </h5>
                      <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] sm:text-xs text-rose-200">
                        {excelParseResult.errors.slice(0, 50).map((err, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="font-mono text-[10px] bg-rose-900/60 px-1.5 py-0.5 rounded shrink-0">
                              Row {err.rowNumber}
                            </span>
                            <span className="break-words flex-1">{err.message}</span>
                          </div>
                        ))}
                        {excelParseResult.errors.length > 50 && (
                          <div className="text-[10px] text-rose-300/80 pt-1 border-t border-rose-900/40">
                            Showing first 50 of {excelParseResult.errors.length.toLocaleString()} errors.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {excelParseResult.rows.length > 0 && (
                    <div>
                      <h5 className="text-xs font-bold text-slate-300 mb-2">
                        Preview (first {Math.min(15, excelParseResult.rows.length)} of{' '}
                        {excelParseResult.rows.length.toLocaleString()} products)
                      </h5>

                      {/* Desktop Table */}
                      <div className="hidden md:block overflow-x-auto border border-slate-800 rounded-xl max-h-80 overflow-y-auto">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-slate-950 text-slate-400 text-[11px] sticky top-0">
                            <tr>
                              <th className="p-2.5">Product Name</th>
                              <th className="p-2.5 text-right">Buying Price</th>
                              <th className="p-2.5 text-right">Selling Price</th>
                              <th className="p-2.5 text-right">Quantity</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                            {excelParseResult.rows.slice(0, 15).map((r, idx) => (
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

                      {/* Mobile Cards */}
                      <div className="md:hidden space-y-2 max-h-72 overflow-y-auto">
                        {excelParseResult.rows.slice(0, 15).map((r, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                          >
                            <div className="font-semibold text-white truncate mb-1">
                              {r.productName}
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                              <span>Buy: {r.buyingPrice.toLocaleString()}</span>
                              <span className="text-emerald-400 font-bold">
                                Sell: {r.sellingPrice.toLocaleString()}
                              </span>
                              <span className="text-blue-300">Qty: {r.quantity}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {excelParseResult.rows.length > 0 && effectiveExcelShopId && (
                    <button
                      type="button"
                      onClick={handleCommitExcelImport}
                      disabled={isCommitting || isParsingExcel}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-6 py-3 rounded-xl shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {isCommitting
                          ? `Importing (${Math.round(excelProgress?.percent ?? 0)}%)...`
                          : `Confirm & Import (${excelParseResult.rows.length.toLocaleString()} products) to ${
                              shops.find(s => s.id === effectiveExcelShopId)?.name || 'Shop'
                            }`}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 2. EXPORT SECTION */}
          {csvSection === 'export' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4 sm:space-y-5">
              <div>
                <h3 className="font-bold text-sm text-white">Export Dataset</h3>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                  Download shop products, sales, inventory logs, purchases, or expenses as Excel or CSV
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 max-w-2xl">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    File Format
                  </label>
                  <select
                    value={exportFormat}
                    onChange={e => setExportFormat(e.target.value as ExportFormat)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="xlsx">📊 Excel (.xlsx)</option>
                    <option value="csv">📄 CSV (.csv)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Data Category
                  </label>
                  <select
                    value={selectedExportType}
                    onChange={e => setSelectedExportType(e.target.value as CsvDataType)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="PRODUCTS">📦 Products</option>
                    <option value="INVENTORY">📊 Inventory</option>
                    <option value="SALES">🛒 Sales</option>
                    <option value="PURCHASES">🚚 Purchases</option>
                    <option value="EXPENSES">📉 Expenses</option>
                    {platformAdmin && <option value="SELLERS">👥 Sellers</option>}
                    {platformAdmin && <option value="SHOPS">🏪 Shops</option>}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Target Shop <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={effectiveExportShopId}
                    onChange={e => setSelectedExportShopId(e.target.value)}
                    className="w-full bg-slate-950 text-xs text-white px-3 py-2.5 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
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

              {exportFormat === 'xlsx' && selectedExportType === 'PRODUCTS' ? (
                <button
                  onClick={handleExportProductsExcel}
                  disabled={!effectiveExportShopId}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold px-5 py-3 sm:py-2.5 rounded-xl shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PRODUCTS Excel</span>
                </button>
              ) : (
                <button
                  onClick={handleExportDataset}
                  disabled={!effectiveExportShopId}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold px-5 py-3 sm:py-2.5 rounded-xl shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    Download {selectedExportType} {exportFormat === 'xlsx' ? 'Excel' : 'CSV'}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* 3. CSV TEMPLATES SECTION */}
          {csvSection === 'templates' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
              <div>
                <h3 className="font-bold text-sm text-white">CSV Templates</h3>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-1">
                  Download pre-formatted templates for bulk data entry
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
                {[
                  {
                    type: 'PRODUCTS' as CsvDataType,
                    emoji: '📦',
                    name: 'Products',
                    desc: 'SKU, prices, initial stock',
                  },
                  {
                    type: 'SHOPS' as CsvDataType,
                    emoji: '🏪',
                    name: 'Shops',
                    desc: 'Names, codes, addresses',
                  },
                  {
                    type: 'EXPENSES' as CsvDataType,
                    emoji: '📉',
                    name: 'Expenses',
                    desc: 'Shop/company expenses',
                  },
                  {
                    type: 'SELLERS' as CsvDataType,
                    emoji: '👥',
                    name: 'Sellers',
                    desc: 'Usernames, assigned shops',
                  },
                ].map(t => (
                  <button
                    key={t.type}
                    onClick={() => handleDownloadTemplate(t.type)}
                    className="p-3 sm:p-4 bg-slate-950 hover:bg-slate-900 rounded-xl border border-slate-800 flex items-center gap-3 active:scale-95 transition text-left"
                  >
                    <span className="text-2xl shrink-0">{t.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-xs text-white">{t.name}</div>
                      <div className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                        {t.desc}
                      </div>
                    </div>
                    <Download className="w-4 h-4 text-blue-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. IMPORT HISTORY SECTION */}
          {csvSection === 'history' && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
              <div>
                <h3 className="font-bold text-sm text-white">Import History</h3>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-1">
                  Log of all bulk uploads processed
                </p>
              </div>

              {importHistory.length > 0 ? (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-x-auto border border-slate-800 rounded-xl">
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
                            <td className="p-3 font-mono text-slate-400 whitespace-nowrap">
                              {formatDateTime(item.createdAt)}
                            </td>
                            <td className="p-3 font-semibold text-white">
                              {item.fileName}
                              {item.format && (
                                <span className="ml-1.5 text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
                                  {item.format}
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                {item.dataType}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className="text-emerald-400 font-bold">
                                {item.successCount}
                              </span>
                              <span className="text-slate-500"> / {item.totalRecords}</span>
                            </td>
                            <td className="p-3 text-slate-300">
                              +{item.createdCount || 0} / ⟳{item.updatedCount || 0}
                              {item.skippedCount ? ` / ⏭${item.skippedCount}` : ''}
                            </td>
                            <td className="p-3 text-slate-300">{item.importedByName}</td>
                            <td className="p-3 text-slate-400 text-[11px]">{item.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="md:hidden space-y-2.5">
                    {importHistory.map(item => (
                      <div
                        key={item.id}
                        className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-white truncate">{item.fileName}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {item.format && (
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
                                {item.format}
                              </span>
                            )}
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                              {item.dataType}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>
                            Success: <b className="text-emerald-400">{item.successCount}</b>/
                            {item.totalRecords}
                          </span>
                          <span>
                            +{item.createdCount || 0} / ⟳{item.updatedCount || 0}
                            {item.skippedCount ? ` / ⏭${item.skippedCount}` : ''}
                          </span>
                        </div>
                        {item.notes && (
                          <div className="text-[10px] text-slate-400 truncate">{item.notes}</div>
                        )}
                        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                          <span>By: {item.importedByName}</span>
                          <span className="font-mono">{formatDateTime(item.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800 text-slate-400 text-xs">
                  No imports recorded yet.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: JSON BACKUP */}
      {activeSubTab === 'backup' && platformAdmin && (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-2 text-blue-400">
                <Download className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white">Export JSON Backup</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 mb-4 leading-relaxed">
                Export all shops, products, sales, purchases, expenses, and sellers as a portable .json file
              </p>
              <button
                onClick={handleExportBackup}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs transition"
              >
                <Download className="w-4 h-4" />
                <span>Download .json Backup</span>
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-2 text-emerald-400">
                <Upload className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white">Restore Database</h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 mb-4 leading-relaxed">
                Restore the entire database from a previously exported backup
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
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition"
              >
                <Upload className="w-4 h-4" />
                <span>Select .json File</span>
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-slate-900/90 border border-rose-900/40 rounded-2xl p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="flex items-start gap-2 text-rose-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <div>
                  <h3 className="font-bold text-sm text-white">Delete All Demo Data</h3>
                  <p className="text-[11px] sm:text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl">
                    Permanently delete products, sales, purchases, expenses, and movements. Your shops and admin account are preserved.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowWipeConfirm(true)}
                className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 active:bg-rose-700 text-rose-300 hover:text-white border border-rose-500/40 font-semibold text-xs transition"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Delete Demo Data</span>
              </button>
            </div>
          </div>

          {/* Wipe Confirmation Modal */}
          {showWipeConfirm && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm sm:p-4">
              <div className="bg-slate-900 border border-rose-800/60 rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-w-md w-full max-h-[92vh] overflow-y-auto shadow-2xl space-y-4">
                <div className="flex items-center gap-3 text-rose-400">
                  <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/50">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Delete All Data?</h4>
                    <p className="text-[11px] text-slate-400">Cannot be undone</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
                  <p className="text-rose-300 font-semibold">Will be cleared:</p>
                  <ul className="list-disc pl-4 space-y-1 text-slate-400 text-[11px]">
                    <li>All products &amp; catalog</li>
                    <li>All sales &amp; receipts</li>
                    <li>All purchases &amp; movements</li>
                    <li>All expenses</li>
                    <li>All debts &amp; notifications</li>
                  </ul>
                  <p className="text-slate-400 text-[11px] pt-1">
                    Admin account and shops will be kept.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowWipeConfirm(false)}
                    disabled={isWiping}
                    className="flex-1 py-3 sm:py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleWipeAllData}
                    disabled={isWiping}
                    className="flex-1 flex items-center justify-center gap-1.5 py-3 sm:py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg transition disabled:opacity-50"
                  >
                    {isWiping ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Purging...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Delete All</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: QUICKBOOKS */}
      {activeSubTab === 'quickbooks' && platformAdmin && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="font-bold text-sm text-white">QuickBooks IIF Importer</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                Paste QuickBooks .IIF text to import products
              </p>
            </div>

            <button
              onClick={handleLoadQBSample}
              className="w-full sm:w-auto px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
            >
              Load Sample IIF Data
            </button>
          </div>

          <textarea
            rows={7}
            value={qbImportText}
            onChange={e => setQbImportText(e.target.value)}
            placeholder="Paste QuickBooks .IIF text here..."
            className="w-full bg-slate-950 font-mono text-xs text-slate-200 p-3 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
          />

          <button
            onClick={handleExecuteQBImport}
            disabled={isProcessingQB || !qbImportText.trim()}
            className="w-full sm:w-auto px-5 py-3 sm:py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs shadow transition disabled:opacity-50"
          >
            {isProcessingQB ? 'Processing IIF...' : 'Import Products from IIF'}
          </button>

          {qbImportResult && (
            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300">
              <span className="font-bold text-emerald-400">Result:</span> Imported{' '}
              {qbImportResult.itemsImported} products.
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: SYNC QUEUE */}
      {activeSubTab === 'sync' && platformAdmin && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="font-bold text-sm text-white">Cloud Database Sync</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                Online-only mode: every change commits immediately to the cloud database
              </p>
            </div>

            <button
              onClick={handleSimulateSync}
              disabled={isSyncing}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 sm:py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync with Cloud'}</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Pending</span>
              <span className="text-sm font-bold text-amber-400">{queueStats.pending}</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Synced</span>
              <span className="text-sm font-bold text-emerald-400">{queueStats.synced}</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center">
              <span className="text-[10px] text-slate-400 block mb-0.5">Total</span>
              <span className="text-sm font-bold text-slate-200">{queueStats.total}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
