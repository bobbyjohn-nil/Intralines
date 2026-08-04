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

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function fmtClock(clockMin: number): { day: string; time: string; week: number } {
  const total = Math.floor(clockMin);
  const week = Math.floor(total / (7 * 1440)) + 1;
  const day = DAYS[Math.floor(total / 1440) % 7];
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return { day, time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, week };
}
