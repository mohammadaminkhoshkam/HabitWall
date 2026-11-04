import type { Day } from './types';

/*
 * Day arithmetic is done on UTC dates built from the 'YYYY-MM-DD' string, so DST and
 * timezone changes can never shift a stored day. Only `logicalDay` looks at the local clock.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function toDay(y: number, m: number, d: number): Day {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseDay(day: Day): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): Day {
  return toDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(day: Day, n: number): Day {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** b − a in whole days. */
export function diffDays(a: Day, b: Day): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(day: Day): number {
  return parseDay(day).getUTCDay();
}

export function dayOfMonth(day: Day): number {
  return parseDay(day).getUTCDate();
}

export function daysInMonth(day: Day): number {
  const d = parseDay(day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function startOfWeek(day: Day, weekStart: number): Day {
  const offset = (weekday(day) - weekStart + 7) % 7;
  return addDays(day, -offset);
}

export function startOfMonth(day: Day): Day {
  return day.slice(0, 8) + '01';
}

export function addMonths(day: Day, n: number): Day {
  const d = parseDay(startOfMonth(day));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fromUtc(d);
}

/** Inclusive range. */
export function dayRange(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function hhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * The user's logical day. With dayStartMinutes = 240 (04:00), 01:30 on the 5th
 * still belongs to the 4th.
 */
export function logicalDay(now: Date, dayStartMinutes: number): Day {
  const local = toDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins < dayStartMinutes ? addDays(local, -1) : local;
}

/** Minutes elapsed since the logical day started (0 … 1439+). */
export function minutesIntoDay(now: Date, dayStartMinutes: number): number {
  const mins = now.getHours() * 60 + now.getMinutes();
  return (mins - dayStartMinutes + 1440) % 1440;
}

/** Wall-clock minute-of-day expressed on the logical-day axis (handles 00:30 with a 04:00 start). */
export function clockToDayAxis(clockMinutes: number, dayStartMinutes: number): number {
  return (clockMinutes - dayStartMinutes + 1440) % 1440;
}

/** Next local moment at which the logical day changes. */
export function nextDayBoundary(now: Date, dayStartMinutes: number): Date {
  const b = new Date(now);
  b.setHours(Math.floor(dayStartMinutes / 60), dayStartMinutes % 60, 0, 0);
  if (b.getTime() <= now.getTime()) b.setDate(b.getDate() + 1);
  return b;
}

export function nowIso(): string {
  return new Date().toISOString();
}
