import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';

export interface CustomDateRangeCalendarProps {
  startDate: string;
  endDate: string;
  onChangeStartDate: (date: string) => void;
  onChangeEndDate: (date: string) => void;
  openTrigger?: number;
  defaultOpen?: boolean;
  accent?: 'amber' | 'blue' | 'emerald' | 'violet' | 'purple';
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalYmd(str?: string): Date | null {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

const ACCENT_STYLES: Record<
  NonNullable<CustomDateRangeCalendarProps['accent']>,
  {
    endpointActive: string;
    dayEdge: string;
    dayRange: string;
    focusRing: string;
    badge: string;
  }
> = {
  amber: {
    endpointActive: 'border-amber-500 bg-amber-500/15 text-amber-200',
    dayEdge: 'bg-amber-500 text-slate-950 font-bold shadow-sm',
    dayRange: 'bg-amber-500/20 text-amber-200 font-semibold',
    focusRing: 'focus:ring-amber-500',
    badge: 'text-amber-300',
  },
  blue: {
    endpointActive: 'border-blue-500 bg-blue-500/15 text-blue-200',
    dayEdge: 'bg-blue-600 text-white font-bold shadow-sm',
    dayRange: 'bg-blue-500/20 text-blue-200 font-semibold',
    focusRing: 'focus:ring-blue-500',
    badge: 'text-blue-300',
  },
  emerald: {
    endpointActive: 'border-emerald-500 bg-emerald-500/15 text-emerald-200',
    dayEdge: 'bg-emerald-600 text-white font-bold shadow-sm',
    dayRange: 'bg-emerald-500/20 text-emerald-200 font-semibold',
    focusRing: 'focus:ring-emerald-500',
    badge: 'text-emerald-300',
  },
  violet: {
    endpointActive: 'border-violet-500 bg-violet-500/15 text-violet-200',
    dayEdge: 'bg-violet-600 text-white font-bold shadow-sm',
    dayRange: 'bg-violet-500/20 text-violet-200 font-semibold',
    focusRing: 'focus:ring-violet-500',
    badge: 'text-violet-300',
  },
  purple: {
    endpointActive: 'border-purple-500 bg-purple-500/15 text-purple-200',
    dayEdge: 'bg-purple-600 text-white font-bold shadow-sm',
    dayRange: 'bg-purple-500/20 text-purple-200 font-semibold',
    focusRing: 'focus:ring-purple-500',
    badge: 'text-purple-300',
  },
};

export const CustomDateRangeCalendar: React.FC<CustomDateRangeCalendarProps> = ({
  startDate,
  endDate,
  onChangeStartDate,
  onChangeEndDate,
  openTrigger,
  defaultOpen = true,
  accent = 'amber',
}) => {
  const todayYmd = useMemo(() => toLocalYmd(new Date()), []);
  const initialAnchor = useMemo(
    () => parseLocalYmd(startDate) || parseLocalYmd(endDate) || new Date(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);
  const [picking, setPicking] = useState<'START' | 'END'>('START');
  const [viewYear, setViewYear] = useState<number>(initialAnchor.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(initialAnchor.getMonth());
  const prevOpenTriggerRef = useRef<number | undefined>(openTrigger);

  useEffect(() => {
    if (openTrigger !== undefined && openTrigger > 0 && openTrigger !== prevOpenTriggerRef.current) {
      prevOpenTriggerRef.current = openTrigger;
      setIsOpen(true);
      setPicking('START');
      const anchor = parseLocalYmd(startDate) || parseLocalYmd(endDate) || new Date();
      setViewYear(anchor.getFullYear());
      setViewMonth(anchor.getMonth());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTrigger]);

  const theme = ACCENT_STYLES[accent];
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear - 10; y <= currentYear + 2; y++) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  const cells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

    const result: Array<{ ymd: string; dayNum: number; inCurrentMonth: boolean }> = [];
    for (let i = 0; i < totalCells; i++) {
      if (i < firstWeekday) {
        const dayNum = prevMonthLastDay - firstWeekday + 1 + i;
        const dt = new Date(viewYear, viewMonth - 1, dayNum);
        result.push({ ymd: toLocalYmd(dt), dayNum, inCurrentMonth: false });
      } else if (i < firstWeekday + daysInMonth) {
        const dayNum = i - firstWeekday + 1;
        const dt = new Date(viewYear, viewMonth, dayNum);
        result.push({ ymd: toLocalYmd(dt), dayNum, inCurrentMonth: true });
      } else {
        const dayNum = i - (firstWeekday + daysInMonth) + 1;
        const dt = new Date(viewYear, viewMonth + 1, dayNum);
        result.push({ ymd: toLocalYmd(dt), dayNum, inCurrentMonth: false });
      }
    }
    return result;
  }, [viewYear, viewMonth]);

  const focusEndpoint = (endpoint: 'START' | 'END') => {
    setPicking(endpoint);
    setIsOpen(true);
    const target = parseLocalYmd(endpoint === 'START' ? startDate : endDate);
    if (target) {
      setViewYear(target.getFullYear());
      setViewMonth(target.getMonth());
    }
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const handleSelectDay = (ymd: string, inCurrentMonth: boolean) => {
    if (!inCurrentMonth) {
      const clicked = parseLocalYmd(ymd);
      if (clicked) {
        setViewYear(clicked.getFullYear());
        setViewMonth(clicked.getMonth());
      }
    }

    if (picking === 'START') {
      onChangeStartDate(ymd);
      if (!endDate || ymd > endDate) {
        onChangeEndDate(ymd);
      }
      setPicking('END');
    } else {
      if (startDate && ymd < startDate) {
        onChangeStartDate(ymd);
        onChangeEndDate(startDate);
      } else {
        onChangeEndDate(ymd);
      }
    }
    setIsOpen(false);
  };

  const handleJumpToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    if (picking === 'START') {
      onChangeStartDate(todayYmd);
      if (!endDate || todayYmd > endDate) {
        onChangeEndDate(todayYmd);
      }
      setPicking('END');
    } else {
      if (startDate && todayYmd < startDate) {
        onChangeStartDate(todayYmd);
        onChangeEndDate(startDate);
      } else {
        onChangeEndDate(todayYmd);
      }
    }
    setIsOpen(false);
  };

  const formatButtonDate = (ymd: string): string => {
    const dt = parseLocalYmd(ymd);
    if (!dt) return 'Select date';
    return `${MONTH_NAMES[dt.getMonth()].slice(0, 3)} ${dt.getDate()}, ${dt.getFullYear()} (${ymd})`;
  };

  return (
    <div className="space-y-2 pt-1 animate-in fade-in duration-150">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <div>
          <label className="text-[10px] text-slate-400 block mb-1">From</label>
          <button
            type="button"
            onClick={() => focusEndpoint('START')}
            aria-label="Custom start date"
            className={`w-full flex items-center justify-between gap-2 bg-slate-950 border rounded-lg px-2.5 py-2 text-xs text-white transition text-left focus:outline-none focus:ring-1 ${theme.focusRing} ${
              isOpen && picking === 'START' ? theme.endpointActive : 'border-slate-800 hover:border-slate-700'
            }`}
          >
            <span className="truncate font-medium">{formatButtonDate(startDate)}</span>
            <Calendar className={`w-3.5 h-3.5 shrink-0 ${theme.badge}`} />
          </button>
        </div>

        <div>
          <label className="text-[10px] text-slate-400 block mb-1">To</label>
          <button
            type="button"
            onClick={() => focusEndpoint('END')}
            aria-label="Custom end date"
            className={`w-full flex items-center justify-between gap-2 bg-slate-950 border rounded-lg px-2.5 py-2 text-xs text-white transition text-left focus:outline-none focus:ring-1 ${theme.focusRing} ${
              isOpen && picking === 'END' ? theme.endpointActive : 'border-slate-800 hover:border-slate-700'
            }`}
          >
            <span className="truncate font-medium">{formatButtonDate(endDate)}</span>
            <Calendar className={`w-3.5 h-3.5 shrink-0 ${theme.badge}`} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(prev => !prev)}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition ${
            isOpen
              ? `${theme.endpointActive}`
              : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>{isOpen ? 'Hide Calendar' : 'Show Calendar'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isOpen && (
        <div className="bg-slate-950/95 border border-slate-800 rounded-xl p-3 space-y-2.5 shadow-xl max-w-md">
          {/* Active endpoint selector + quick actions */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
              <button
                type="button"
                onClick={() => focusEndpoint('START')}
                className={`flex-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition text-left truncate ${
                  picking === 'START'
                    ? theme.endpointActive
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                From: <span className="font-mono">{startDate || 'Select'}</span>
              </button>
              <button
                type="button"
                onClick={() => focusEndpoint('END')}
                className={`flex-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition text-left truncate ${
                  picking === 'END'
                    ? theme.endpointActive
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                To: <span className="font-mono">{endDate || 'Select'}</span>
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleJumpToday}
                className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-semibold text-blue-300 transition"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-200 transition"
              >
                Done
              </button>
            </div>
          </div>

          {/* Month & Year Navigation */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Previous month"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5">
              <select
                value={viewMonth}
                onChange={e => setViewMonth(Number(e.target.value))}
                aria-label="Calendar month"
                className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={viewYear}
                onChange={e => setViewYear(Number(e.target.value))}
                aria-label="Calendar year"
                className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {yearOptions.map(y => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next month"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map(w => (
              <div
                key={w}
                className="text-[10px] font-bold uppercase tracking-wider text-slate-500 py-1"
              >
                {w}
              </div>
            ))}
          </div>

          {/* Calendar days grid */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map(cell => {
              const isStart = Boolean(startDate && cell.ymd === startDate);
              const isEnd = Boolean(endDate && cell.ymd === endDate);
              const isInRange = Boolean(
                startDate && endDate && cell.ymd > startDate && cell.ymd < endDate
              );
              const isToday = cell.ymd === todayYmd;

              let btnClass = cell.inCurrentMonth
                ? 'text-slate-200 hover:bg-slate-800'
                : 'text-slate-600 hover:bg-slate-900 hover:text-slate-400';

              if (isStart || isEnd) {
                btnClass = theme.dayEdge;
              } else if (isInRange) {
                btnClass = theme.dayRange;
              }

              return (
                <button
                  key={cell.ymd}
                  type="button"
                  onClick={() => handleSelectDay(cell.ymd, cell.inCurrentMonth)}
                  className={`h-8 rounded-lg text-xs transition flex items-center justify-center ${btnClass} ${
                    isToday && !isStart && !isEnd ? 'ring-1 ring-blue-400/70' : ''
                  }`}
                >
                  {cell.dayNum}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
