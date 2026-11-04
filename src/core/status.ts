import { addDays, clockToDayAxis, minutesOf, startOfWeek } from './dates';
import { isDue, isWeeklyQuota, weeklyQuota } from './schedule';
import type { CalendarContext, Checkin, CheckinMap, Day, DisplayStatus, Habit } from './types';
import { checkinKey } from './types';

export function targetOf(habit: Habit, checkin?: Checkin | null): number {
  const t = checkin?.targetSnapshot ?? habit.targetValue;
  return t > 0 ? t : 1;
}

/** Fully completed (status done, or reached the target). */
export function isComplete(habit: Habit, c?: Checkin | null): boolean {
  if (!c) return false;
  if (c.status === 'done') return true;
  if (c.status === 'skipped' || c.status === 'rest') return false;
  return c.value >= targetOf(habit, c);
}

/** Counts for the streak: complete, or at least the minimum version. */
export function isSuccess(habit: Habit, c?: Checkin | null): boolean {
  if (!c) return false;
  if (isComplete(habit, c)) return true;
  if (c.status === 'skipped' || c.status === 'rest') return false;
  return habit.minValue != null && habit.minValue > 0 && c.value >= habit.minValue;
}

/** Neutral days neither break a streak nor count against consistency. */
export function isNeutral(c?: Checkin | null): boolean {
  return c?.status === 'rest';
}

/**
 * Consistency credit for one due day: 1 for done, value/target for partial,
 * 0 for skipped/missed, null for rest days (excluded from the denominator).
 */
export function creditOf(habit: Habit, c?: Checkin | null): number | null {
  if (!c) return 0;
  if (c.status === 'rest') return null;
  if (c.status === 'skipped') return 0;
  if (isComplete(habit, c)) return 1;
  return Math.max(0, Math.min(1, c.value / targetOf(habit, c)));
}

export function progressRatio(habit: Habit, c?: Checkin | null): number {
  if (!c) return 0;
  if (isComplete(habit, c)) return 1;
  return Math.max(0, Math.min(1, c.value / targetOf(habit, c)));
}

/** Completions in the week containing `day` (for times_per_week habits). */
export function weekCompletions(
  habit: Habit,
  day: Day,
  checkins: CheckinMap,
  ctx: CalendarContext,
  upTo: Day = addDays(startOfWeek(day, ctx.weekStart), 6),
): number {
  const start = startOfWeek(day, ctx.weekStart);
  let n = 0;
  for (let d = start; d <= upTo; d = addDays(d, 1)) {
    if (isComplete(habit, checkins.get(checkinKey(habit.id, d)))) n++;
  }
  return n;
}

export interface StatusOptions {
  today: Day;
  /** Current position in the logical day, in minutes since day start (for overdue). */
  minutesIntoToday?: number;
  dayStartMinutes?: number;
}

export function displayStatus(
  habit: Habit,
  day: Day,
  checkins: CheckinMap,
  ctx: CalendarContext,
  opts: StatusOptions,
): DisplayStatus {
  if (!isDue(habit, day, ctx)) return 'not_due';
  const c = checkins.get(checkinKey(habit.id, day));

  if (c?.status === 'rest') return 'rest';
  if (c?.status === 'skipped') return 'skipped';
  if (isComplete(habit, c)) return 'done';

  if (isWeeklyQuota(habit, day)) {
    const quota = weeklyQuota(habit, day);
    if (weekCompletions(habit, day, checkins, ctx) >= quota) return 'week_done';
  }

  const started = !!c && (c.value > 0 || !!c.activeSince || c.status === 'partial');

  if (day < opts.today) {
    if (isWeeklyQuota(habit, day)) return started ? 'partial' : 'not_due';
    return started ? 'partial' : 'missed';
  }
  if (started) return 'active';

  if (
    day === opts.today &&
    habit.preferredTime &&
    opts.minutesIntoToday != null &&
    opts.dayStartMinutes != null &&
    opts.minutesIntoToday > clockToDayAxis(minutesOf(habit.preferredTime), opts.dayStartMinutes)
  ) {
    return 'overdue';
  }
  return 'pending';
}

/** Color family used by the UI for each display status. */
export function statusTone(s: DisplayStatus): 'red' | 'blue' | 'green' | 'gray' {
  switch (s) {
    case 'pending':
    case 'overdue':
    case 'missed':
      return 'red';
    case 'active':
    case 'partial':
      return 'blue';
    case 'done':
    case 'week_done':
      return 'green';
    default:
      return 'gray';
  }
}
