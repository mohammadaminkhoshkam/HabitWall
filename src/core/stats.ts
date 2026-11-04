import { addDays, startOfWeek } from './dates';
import { isDue, isWeeklyQuota, weeklyQuota } from './schedule';
import { creditOf, isComplete, isSuccess, weekCompletions } from './status';
import type { CalendarContext, Checkin, CheckinMap, Day, Habit } from './types';
import { checkinKey } from './types';

export function buildCheckinMap(checkins: Iterable<Checkin>): CheckinMap {
  const m: CheckinMap = new Map();
  for (const c of checkins) m.set(checkinKey(c.habitId, c.day), c);
  return m;
}

type Outcome = 'success' | 'fail' | 'neutral' | 'pending' | 'not_due';

/** How one day affects the streak. Today never breaks a streak. */
export function dayOutcome(
  habit: Habit,
  day: Day,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
): Outcome {
  if (!isDue(habit, day, ctx)) return 'not_due';
  const c = checkins.get(checkinKey(habit.id, day));
  if (c?.status === 'rest' || c?.status === 'skipped') return 'neutral';
  if (isSuccess(habit, c)) return 'success';
  return day >= today ? 'pending' : 'fail';
}

function weekOutcome(
  habit: Habit,
  weekStartDay: Day,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
): Outcome {
  const weekEnd = addDays(weekStartDay, 6);
  if (weekEnd < habit.startDay) return 'not_due';
  const quota = weeklyQuota(habit, weekStartDay < habit.startDay ? habit.startDay : weekStartDay);
  const done = weekCompletions(habit, weekStartDay, checkins, ctx, weekEnd < today ? weekEnd : today);
  if (done >= quota) return 'success';
  return weekEnd >= today ? 'pending' : 'fail';
}

export interface HabitStats {
  streakUnit: 'day' | 'week';
  currentStreak: number;
  bestStreak: number;
  /** Consecutive failed periods ending before today — drives Recovery Mode. */
  missedRun: number;
  consistency7: number | null;
  consistency30: number | null;
  completion7: number | null;
  completion30: number | null;
  totalCompletions: number;
}

const MAX_LOOKBACK = 3660;

export function computeHabitStats(
  habit: Habit,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
): HabitStats {
  const weekly = isWeeklyQuota(habit, today);
  let total = 0;
  for (const c of checkins.values()) if (c.habitId === habit.id && isComplete(habit, c)) total++;

  if (weekly) return { ...weeklyStats(habit, checkins, ctx, today), totalCompletions: total };

  // Current streak + missed run: walk backwards.
  let current = 0;
  let missedRun = 0;
  let countingMisses = true;
  let streakOpen = true;
  for (let i = 0, d = today; i < MAX_LOOKBACK && d >= habit.startDay; i++, d = addDays(d, -1)) {
    const o = dayOutcome(habit, d, checkins, ctx, today);
    if (o === 'fail') {
      if (countingMisses) missedRun++;
      streakOpen = false;
      if (!countingMisses) break;
    } else if (o === 'success') {
      countingMisses = false;
      if (streakOpen) current++;
      else break;
    } else if (o === 'neutral') {
      countingMisses = false;
    }
  }

  // Best streak: walk forwards.
  let best = 0;
  let run = 0;
  for (let d = habit.startDay, i = 0; d <= today && i < MAX_LOOKBACK; d = addDays(d, 1), i++) {
    const o = dayOutcome(habit, d, checkins, ctx, today);
    if (o === 'success') best = Math.max(best, ++run);
    else if (o === 'fail') run = 0;
  }

  return {
    streakUnit: 'day',
    currentStreak: current,
    bestStreak: Math.max(best, current),
    missedRun,
    consistency7: windowMetric(habit, checkins, ctx, today, 7, 'credit'),
    consistency30: windowMetric(habit, checkins, ctx, today, 30, 'credit'),
    completion7: windowMetric(habit, checkins, ctx, today, 7, 'complete'),
    completion30: windowMetric(habit, checkins, ctx, today, 30, 'complete'),
    totalCompletions: total,
  };
}

function windowMetric(
  habit: Habit,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
  days: number,
  mode: 'credit' | 'complete',
): number | null {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    if (!isDue(habit, d, ctx)) continue;
    const c = checkins.get(checkinKey(habit.id, d));
    // Today only counts once it is resolved, so an unfinished morning isn't a penalty.
    if (d === today && !isSuccess(habit, c) && c?.status !== 'skipped') continue;
    const credit = creditOf(habit, c);
    if (credit == null) continue;
    sum += mode === 'credit' ? credit : isComplete(habit, c) ? 1 : 0;
    count++;
  }
  return count ? sum / count : null;
}

function weeklyStats(
  habit: Habit,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
): Omit<HabitStats, 'totalCompletions'> {
  const thisWeek = startOfWeek(today, ctx.weekStart);
  const firstWeek = startOfWeek(habit.startDay, ctx.weekStart);

  let current = 0;
  let missedRun = 0;
  let countingMisses = true;
  let open = true;
  for (let w = thisWeek, i = 0; w >= firstWeek && i < 530; w = addDays(w, -7), i++) {
    const o = weekOutcome(habit, w, checkins, ctx, today);
    if (o === 'fail') {
      if (countingMisses) missedRun++;
      open = false;
      if (!countingMisses) break;
    } else if (o === 'success') {
      countingMisses = false;
      if (open) current++;
      else break;
    }
  }

  let best = 0;
  let run = 0;
  for (let w = firstWeek, i = 0; w <= thisWeek && i < 530; w = addDays(w, 7), i++) {
    const o = weekOutcome(habit, w, checkins, ctx, today);
    if (o === 'success') best = Math.max(best, ++run);
    else if (o === 'fail') run = 0;
  }

  const metric = (weeks: number, mode: 'credit' | 'complete') => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < weeks; i++) {
      const w = addDays(thisWeek, -7 * i);
      if (addDays(w, 6) < habit.startDay) break;
      const o = weekOutcome(habit, w, checkins, ctx, today);
      const quota = weeklyQuota(habit, w < habit.startDay ? habit.startDay : w);
      const done = weekCompletions(habit, w, checkins, ctx);
      if (o === 'pending' && done < quota) continue;
      sum += mode === 'credit' ? Math.min(1, done / quota) : o === 'success' ? 1 : 0;
      count++;
    }
    return count ? sum / count : null;
  };

  return {
    streakUnit: 'week',
    currentStreak: current,
    bestStreak: Math.max(best, current),
    missedRun,
    consistency7: metric(1, 'credit'),
    consistency30: metric(5, 'credit'),
    completion7: metric(1, 'complete'),
    completion30: metric(5, 'complete'),
  };
}

// ---------- Heatmap & calendar ----------

export type HeatCell =
  | { kind: 'off' } // not due / outside lifetime
  | { kind: 'future' }
  | { kind: 'rest' }
  | { kind: 'miss' }
  | { kind: 'open' } // today, nothing yet
  | { kind: 'level'; level: 1 | 2 | 3 | 4 };

export function heatCell(
  habit: Habit,
  day: Day,
  checkins: CheckinMap,
  ctx: CalendarContext,
  today: Day,
): HeatCell {
  if (day > today) return { kind: 'future' };
  const c = checkins.get(checkinKey(habit.id, day));
  const weekly = isWeeklyQuota(habit, day);
  if (!isDue(habit, day, ctx)) return { kind: 'off' };
  if (c?.status === 'rest' || c?.status === 'skipped') return { kind: 'rest' };
  const credit = creditOf(habit, c) ?? 0;
  if (credit <= 0) {
    if (weekly) return { kind: 'off' };
    return day === today ? { kind: 'open' } : { kind: 'miss' };
  }
  if (credit >= 1) return { kind: 'level', level: 4 };
  return { kind: 'level', level: Math.max(1, Math.min(3, Math.ceil(credit * 3))) as 1 | 2 | 3 };
}

export interface DaySummary {
  day: Day;
  due: number;
  done: number;
  /** 0..1 credit-weighted, null when nothing was due */
  ratio: number | null;
}

export function daySummary(
  habits: Habit[],
  day: Day,
  checkins: CheckinMap,
  ctx: CalendarContext,
): DaySummary {
  let due = 0;
  let done = 0;
  let credit = 0;
  for (const h of habits) {
    if (!isDue(h, day, ctx)) continue;
    const c = checkins.get(checkinKey(h.id, day));
    if (isWeeklyQuota(h, day) && !c) continue; // flexible habits only count on days they happen
    const cr = creditOf(h, c);
    if (cr == null) continue;
    due++;
    credit += cr;
    if (isComplete(h, c)) done++;
  }
  return { day, due, done, ratio: due ? credit / due : null };
}

export function strengthOf(ratio: number | null): 'none' | 'weak' | 'good' | 'strong' {
  if (ratio == null) return 'none';
  if (ratio >= 0.999) return 'strong';
  if (ratio >= 0.6) return 'good';
  return 'weak';
}
