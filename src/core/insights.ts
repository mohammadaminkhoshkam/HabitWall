import { addDays, diffDays, weekday } from './dates';
import { isDue, isWeeklyQuota } from './schedule';
import { computeHabitStats } from './stats';
import { isComplete } from './status';
import type { CalendarContext, CheckinMap, Day, Habit } from './types';
import { checkinKey } from './types';

export interface ProgressEventLite {
  habitId: string;
  day: Day;
  /** ISO timestamp */
  createdAt: string;
}

/** Structured so the UI phrases them from the dictionary. Kept short and non-judgmental. */
export type Insight =
  | { kind: 'time_of_day'; habitId: string; beforeHour: number; liftPct: number }
  | { kind: 'weekday_miss'; habitId: string; weekday: number }
  | { kind: 'most_consistent'; habitId: string; ratio: number };

const MIN_DAYS = 14;
const LOOKBACK = 56;

export function findInsights(
  habits: Habit[],
  checkins: CheckinMap,
  events: ProgressEventLite[],
  ctx: CalendarContext,
  today: Day,
): Insight[] {
  const out: Insight[] = [];
  const mature = habits.filter((h) => !h.archivedAt && diffDays(h.startDay, today) >= MIN_DAYS);

  let worstWeekday: { insight: Insight; rate: number } | null = null;
  for (const h of mature) {
    const t = timeOfDayInsight(h, checkins, events);
    if (t) out.push(t);
    if (!isWeeklyQuota(h, today)) {
      const w = weekdayMissInsight(h, checkins, ctx, today);
      if (w && (!worstWeekday || w.rate > worstWeekday.rate)) worstWeekday = w;
    }
  }
  // One weekday pattern at most: several at once reads as nagging.
  if (worstWeekday) out.push(worstWeekday.insight);

  if (mature.length >= 2) {
    let best: { id: string; r: number } | null = null;
    for (const h of mature) {
      const r = computeHabitStats(h, checkins, ctx, today).consistency30;
      if (r != null && (!best || r > best.r)) best = { id: h.id, r };
    }
    if (best && best.r >= 0.6) out.push({ kind: 'most_consistent', habitId: best.id, ratio: best.r });
  }
  return out.slice(0, 4);
}

function timeOfDayInsight(
  habit: Habit,
  checkins: CheckinMap,
  events: ProgressEventLite[],
): Insight | null {
  // First touch of each day, as a local hour.
  const firstHour = new Map<Day, number>();
  for (const e of events) {
    if (e.habitId !== habit.id) continue;
    const d = new Date(e.createdAt);
    const h = d.getHours() + d.getMinutes() / 60;
    const prev = firstHour.get(e.day);
    if (prev == null || h < prev) firstHour.set(e.day, h);
  }
  if (firstHour.size < 8) return null;

  let best: Insight | null = null;
  for (const cutoff of [9, 12, 18, 21]) {
    let bN = 0, bDone = 0, aN = 0, aDone = 0;
    for (const [day, hour] of firstHour) {
      const done = isComplete(habit, checkins.get(checkinKey(habit.id, day)));
      if (hour < cutoff) { bN++; if (done) bDone++; } else { aN++; if (done) aDone++; }
    }
    if (bN < 4 || aN < 4) continue;
    const rb = bDone / bN;
    const ra = aDone / aN;
    if (ra <= 0 || rb <= ra) continue;
    const lift = Math.round(((rb - ra) / ra) * 100);
    if (lift >= 20 && (!best || (best.kind === 'time_of_day' && lift > best.liftPct))) {
      best = { kind: 'time_of_day', habitId: habit.id, beforeHour: cutoff, liftPct: Math.min(lift, 300) };
    }
  }
  return best;
}

function weekdayMissInsight(
  habit: Habit,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
): { insight: Insight; rate: number } | null {
  const due = new Array(7).fill(0);
  const miss = new Array(7).fill(0);
  let totalDue = 0, totalMiss = 0;
  for (let i = 1; i <= LOOKBACK; i++) {
    const d = addDays(today, -i);
    if (d < habit.startDay) break;
    if (!isDue(habit, d, ctx)) continue;
    const c = checkins.get(checkinKey(habit.id, d));
    if (c?.status === 'rest') continue;
    const wd = weekday(d);
    const missed = !isComplete(habit, c);
    due[wd]++; totalDue++;
    if (missed) { miss[wd]++; totalMiss++; }
  }
  if (totalDue < 12) return null;
  const overall = totalMiss / totalDue;
  let worst = -1, worstRate = 0;
  for (let wd = 0; wd < 7; wd++) {
    if (due[wd] < 4) continue;
    const r = miss[wd] / due[wd];
    if (r > worstRate) [worst, worstRate] = [wd, r];
  }
  if (worst < 0 || worstRate < 0.6 || worstRate - overall < 0.3) return null;
  return { insight: { kind: 'weekday_miss', habitId: habit.id, weekday: worst }, rate: worstRate - overall };
}
