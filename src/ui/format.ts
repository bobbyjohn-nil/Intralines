export function fmtMoney(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  // floor, never round up: the display must not claim money you don't have
  if (a >= 1_000_000) return `${sign}$${(Math.floor(a / 10_000) / 100).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${Math.floor(a / 1000)}k`;
  return `${sign}$${Math.floor(a).toLocaleString('en-US')}`;
}

export function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

import { DAYS_PER_QUARTER, QUARTERS_PER_YEAR } from '../game/constants';

/** game calendar: 16-day quarters, 4 quarters to a year */
export function fmtClock(clockMin: number): {
  year: number;
  quarter: number;
  day: number;
  time: string;
} {
  const total = Math.floor(clockMin);
  const dayIdx = Math.floor(total / 1440);
  const year = Math.floor(dayIdx / (DAYS_PER_QUARTER * QUARTERS_PER_YEAR)) + 1;
  const quarter = Math.floor(dayIdx / DAYS_PER_QUARTER) % QUARTERS_PER_YEAR + 1;
  const day = (dayIdx % DAYS_PER_QUARTER) + 1;
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return {
    year,
    quarter,
    day,
    time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
  };
}
