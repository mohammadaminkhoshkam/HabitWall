import { parseDay } from '../core/dates';
import type { Day } from '../core/types';
import { unitLabel } from '../core/units';
import { en, type DictKey } from './en';

const LOCALE = 'en-US';

export interface I18n {
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  /** "{n} day|{n} days" plural forms */
  plural: (key: DictKey, n: number) => string;
  num: (n: number, maxFraction?: number) => string;
  pct: (ratio: number | null) => string;
  weekdayName: (wd: number, style?: 'long' | 'short' | 'narrow') => string;
  dayLabel: (day: Day, opts?: Intl.DateTimeFormatOptions) => string;
  monthLabel: (day: Day) => string;
  amount: (value: number, unit: string | null) => string;
  time: (hhmm: string) => string;
}

export function makeI18n(): I18n {
  const nf = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
  const num = (n: number, maxFraction = 1) =>
    maxFraction === 1 ? nf.format(n) : new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxFraction }).format(n);

  const t: I18n['t'] = (key, vars) => {
    let s: string = en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(typeof v === 'number' ? num(v) : v);
    return s;
  };

  // Reference Sunday (2023-01-01) for weekday names.
  const weekdayName: I18n['weekdayName'] = (wd, style = 'long') =>
    new Intl.DateTimeFormat(LOCALE, { weekday: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + wd)));

  return {
    t,
    plural: (key, n) => {
      const [one, many] = en[key].split('|');
      return (n === 1 ? one : many ?? one).split('{n}').join(num(n));
    },
    num,
    pct: (r) => (r == null ? '—' : `${num(Math.round(r * 100))}%`),
    weekdayName,
    dayLabel: (day, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
      new Intl.DateTimeFormat(LOCALE, { ...opts, timeZone: 'UTC' }).format(parseDay(day)),
    monthLabel: (day) => new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDay(day)),
    amount: (value, unit) => {
      const u = unitLabel(unit);
      return u ? `${num(value)} ${u}` : num(value);
    },
    time: (hhmm) => {
      const [h, m] = hhmm.split(':').map(Number);
      return new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1, h, m)));
    },
  };
}
