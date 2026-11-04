import { dayOfMonth, daysInMonth, diffDays, weekday } from './dates';
import type { CalendarContext, Day, Habit, Schedule } from './types';

/** The schedule version in force on `day` (schedules are versioned, never rewritten). */
export function scheduleFor(habit: Habit, day: Day): Schedule {
  const s = habit.schedules;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i].effectiveFrom <= day) return s[i];
  }
  return s[0];
}

export function isWithinLifetime(habit: Habit, day: Day): boolean {
  if (day < habit.startDay) return false;
  if (habit.endDay && day > habit.endDay) return false;
  if (habit.archivedAt && day > habit.archivedAt.slice(0, 10)) return false;
  return true;
}

/** Weekly-quota habits are evaluated per week, not per day. */
export function isWeeklyQuota(habit: Habit, day: Day): boolean {
  return scheduleFor(habit, day).kind === 'times_per_week';
}

/**
 * Whether the habit is expected on `day`. For `times_per_week` every day is eligible;
 * the quota itself is handled by status/stats.
 */
export function isDue(habit: Habit, day: Day, ctx: CalendarContext): boolean {
  if (!isWithinLifetime(habit, day)) return false;
  const s = scheduleFor(habit, day);
  const wd = weekday(day);
  switch (s.kind) {
    case 'daily':
    case 'times_per_week':
      return true;
    case 'weekdays':
      return !ctx.weekendDays.includes(wd);
    case 'weekends':
      return ctx.weekendDays.includes(wd);
    case 'days_of_week':
      return (s.params.days ?? []).includes(wd);
    case 'every_n_days': {
      const n = Math.max(1, s.params.n ?? 1);
      const anchor = s.effectiveFrom > habit.startDay ? s.effectiveFrom : habit.startDay;
      const diff = diffDays(anchor, day);
      return diff >= 0 && diff % n === 0;
    }
    case 'days_of_month': {
      const dates = s.params.dates ?? [];
      const dom = dayOfMonth(day);
      if (dates.includes(dom)) return true;
      // "31st" in a 30-day month → due on the last day.
      const last = daysInMonth(day);
      return dom === last && dates.some((d) => d > last);
    }
  }
}

export function weeklyQuota(habit: Habit, day: Day): number {
  const s = scheduleFor(habit, day);
  return s.kind === 'times_per_week' ? Math.max(1, Math.min(7, s.params.n ?? 1)) : 0;
}
