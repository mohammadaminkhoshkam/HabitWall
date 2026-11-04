/*
 * Month grids for the calendar and heatmaps. Days are 'YYYY-MM-DD' strings (UTC-based).
 */
import { addDays, parseDay } from '../core/dates';
import type { Day } from '../core/types';

export function dayOfMonth(day: Day): number {
  return parseDay(day).getUTCDate();
}

export function monthStart(day: Day): Day {
  return addDays(day, -(dayOfMonth(day) - 1));
}

export function monthDays(day: Day): Day[] {
  const start = monthStart(day);
  const out: Day[] = [];
  for (let d = start; out.length < 32; d = addDays(d, 1)) {
    if (out.length && dayOfMonth(d) === 1) break;
    out.push(d);
  }
  return out;
}

export function shiftMonth(day: Day, delta: number): Day {
  let d = monthStart(day);
  if (delta > 0) for (let i = 0; i < delta; i++) d = addDays(monthDays(d).at(-1)!, 1);
  else for (let i = 0; i < -delta; i++) d = monthStart(addDays(d, -1));
  return d;
}

export function monthTitle(day: Day): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDay(day));
}
