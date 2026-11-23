import React from 'react';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import type { ImportProgressInfo } from '../../services/excelImportService';

interface ImportProgressBarProps {
  progress: ImportProgressInfo | null;
  phaseLabel?: string;
}

export const ImportProgressBar: React.FC<ImportProgressBarProps> = ({
  progress,
  phaseLabel,
}) => {
  if (!progress) return null;

  const pct = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
  const isDone = progress.stage === 'DONE' || pct >= 100;

  return (
    <div className="bg-slate-950 border border-blue-500/35 rounded-xl p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isDone ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
          )}
          <span className="font-semibold text-white truncate">
            {phaseLabel || progress.stage}
          </span>
        </div>
        <span className="font-mono font-bold text-blue-300 shrink-0">{pct}%</span>
      </div>

      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-200 ${
            isDone
              ? 'bg-emerald-500'
              : 'bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="truncate">{progress.message}</span>
        {progress.totalRows > 0 && (
          <span className="font-mono shrink-0 text-slate-300">
            {progress.processedRows.toLocaleString()} / {progress.totalRows.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
};
