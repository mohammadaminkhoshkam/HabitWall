import { addDays, weekday } from './dates';
import { isDue, isWeeklyQuota, weeklyQuota } from './schedule';
import { isComplete } from './status';
import type { CalendarContext, CheckinMap, Day, Habit } from './types';
import { checkinKey } from './types';

export interface ReviewRow {
  habitId: string;
  title: string;
  done: number;
  due: number;
  ratio: number | null;
}

export interface WeeklyReview {
  weekStart: Day;
  weekEnd: Day;
  rows: ReviewRow[];
  overall: number | null;
  previousOverall: number | null;
  /** overall − previousOverall, in ratio points */
  trend: number | null;
  bestHabitId: string | null;
  needsAttentionId: string | null;
  /** 0 = Sunday … 6 = Saturday */
  mostProductiveWeekday: number | null;
}

function rowsFor(
  habits: Habit[],
  weekStart: Day,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
): ReviewRow[] {
  const end = addDays(weekStart, 6);
  const rows: ReviewRow[] = [];
  for (const h of habits) {
    if (h.startDay > end) continue;
    let due = 0;
    let done = 0;
    if (isWeeklyQuota(h, weekStart < h.startDay ? h.startDay : weekStart)) {
      const quota = weeklyQuota(h, weekStart < h.startDay ? h.startDay : weekStart);
      for (let d = weekStart; d <= end && d <= today; d = addDays(d, 1)) {
        if (isComplete(h, checkins.get(checkinKey(h.id, d)))) done++;
      }
      due = quota;
      done = Math.min(done, quota);
    } else {
      for (let d = weekStart; d <= end && d <= today; d = addDays(d, 1)) {
        if (!isDue(h, d, ctx)) continue;
        const c = checkins.get(checkinKey(h.id, d));
        if (c?.status === 'rest') continue;
        // Today counts only once finished — an in-progress morning is not a miss.
        if (d === today && !isComplete(h, c) && c?.status !== 'skipped') continue;
        due++;
        if (isComplete(h, c)) done++;
      }
    }
    if (due > 0) rows.push({ habitId: h.id, title: h.title, done, due, ratio: done / due });
  }
  return rows;
}

const overallOf = (rows: ReviewRow[]) => {
  const due = rows.reduce((a, r) => a + r.due, 0);
  return due ? rows.reduce((a, r) => a + r.done, 0) / due : null;
};

export function weeklyReview(
  habits: Habit[],
  weekStart: Day,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
): WeeklyReview {
  const rows = rowsFor(habits, weekStart, checkins, ctx, today);
  const prev = rowsFor(habits, addDays(weekStart, -7), checkins, ctx, today);
  const overall = overallOf(rows);
  const previousOverall = overallOf(prev);

  const ranked = [...rows].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || b.done - a.done);
  const best = ranked.length && (ranked[0].ratio ?? 0) > 0 ? ranked[0].habitId : null;
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const needsAttention = worst && (worst.ratio ?? 0) < 0.7 && worst.habitId !== best ? worst.habitId : null;

  const perDay = new Map<number, number>();
  for (let d = weekStart; d <= addDays(weekStart, 6) && d <= today; d = addDays(d, 1)) {
    let n = 0;
    for (const h of habits) if (isComplete(h, checkins.get(checkinKey(h.id, d)))) n++;
    if (n > 0) perDay.set(weekday(d), n);
  }
  let mostProductive: number | null = null;
  let max = 0;
  for (const [wd, n] of perDay) if (n > max) [max, mostProductive] = [n, wd];

  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    rows,
    overall,
    previousOverall,
    trend: overall != null && previousOverall != null ? overall - previousOverall : null,
    bestHabitId: best,
    needsAttentionId: needsAttention,
    mostProductiveWeekday: mostProductive,
  };
}
