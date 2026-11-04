import { useMemo } from 'react';
import { minutesOf, clockToDayAxis } from '../core/dates';
import { isDue, isWeeklyQuota, weeklyQuota } from '../core/schedule';
import { computeHabitStats, type HabitStats } from '../core/stats';
import { displayStatus, progressRatio, statusTone, weekCompletions } from '../core/status';
import type { CalendarContext, Checkin, DisplayStatus, Habit } from '../core/types';
import { checkinKey } from '../core/types';
import { useApp } from './store';

export interface TodayRow {
  habit: Habit;
  checkin: Checkin | null;
  status: DisplayStatus;
  tone: 'red' | 'blue' | 'green' | 'gray';
  ratio: number;
  stats: HabitStats;
  weekly: { done: number; quota: number } | null;
  focus: boolean;
}

export interface TodayModel {
  focusRows: TodayRow[];
  openRows: TodayRow[];
  doneRows: TodayRow[];
  restRows: TodayRow[];
  doneCount: number;
  total: number;
}

export function useCalendarCtx(): CalendarContext {
  const weekendDays = useApp((s) => s.settings.weekendDays);
  const weekStart = useApp((s) => s.settings.weekStart);
  return useMemo(() => ({ weekendDays, weekStart }), [weekendDays, weekStart]);
}

const TOD_ORDER = { morning: 0, afternoon: 1, evening: 2, any: 3 } as const;

export function useToday(): TodayModel {
  const habits = useApp((s) => s.habits);
  const checkins = useApp((s) => s.checkins);
  const today = useApp((s) => s.today);
  const focus = useApp((s) => s.focus);
  const minuteOfDay = useApp((s) => s.minuteOfDay);
  const dayStart = useApp((s) => s.settings.dayStartMinutes);
  const celebrate = useApp((s) => s.celebrate);
  const ctx = useCalendarCtx();

  return useMemo(() => {
    const rows: TodayRow[] = [];
    for (const habit of habits) {
      if (habit.archivedAt || !isDue(habit, today, ctx)) continue;
      const checkin = checkins.get(checkinKey(habit.id, today)) ?? null;
      const status = displayStatus(habit, today, checkins, ctx, { today, minutesIntoToday: minuteOfDay, dayStartMinutes: dayStart });
      const weekly = isWeeklyQuota(habit, today)
        ? { done: weekCompletions(habit, today, checkins, ctx), quota: weeklyQuota(habit, today) }
        : null;
      rows.push({
        habit,
        checkin,
        status,
        tone: statusTone(status),
        ratio: progressRatio(habit, checkin),
        stats: computeHabitStats(habit, checkins, ctx, today),
        weekly,
        focus: focus.includes(habit.id),
      });
    }
    const timeKey = (h: Habit) =>
      h.preferredTime ? clockToDayAxis(minutesOf(h.preferredTime), dayStart) : 2000 + TOD_ORDER[h.timeOfDay] * 100;
    rows.sort((a, b) => timeKey(a.habit) - timeKey(b.habit) || a.habit.sortOrder - b.habit.sortOrder);

    // A just-completed row stays in place while its check animation plays.
    const isDone = (r: TodayRow) => (r.status === 'done' || r.status === 'week_done') && r.habit.id !== celebrate;
    const isRest = (r: TodayRow) => r.status === 'skipped' || r.status === 'rest';
    const focusRows = focus.map((id) => rows.find((r) => r.habit.id === id)).filter((r): r is TodayRow => !!r);
    return {
      focusRows,
      openRows: rows.filter((r) => !r.focus && !isDone(r) && !isRest(r)),
      doneRows: rows.filter((r) => !r.focus && isDone(r)),
      restRows: rows.filter((r) => !r.focus && isRest(r)),
      doneCount: rows.filter((r) => r.status === 'done' || r.status === 'week_done').length,
      total: rows.filter((r) => !isRest(r)).length,
    };
  }, [habits, checkins, today, focus, minuteOfDay, dayStart, ctx, celebrate]);
}
