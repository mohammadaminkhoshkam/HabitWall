import { clockToDayAxis, minutesOf } from './dates';
import { isDue } from './schedule';
import { displayStatus } from './status';
import type { CalendarContext, CheckinMap, Day, Habit } from './types';

export interface ReminderRule {
  id: string;
  habitId: string;
  kind: 'fixed' | 'after_startup' | 'end_of_day' | 'custom';
  time: string | null;
  enabled: boolean;
  snoozedUntil: string | null;
}

export interface ReminderPlanInput {
  now: Date;
  today: Day;
  minuteOfDay: number;
  dayStartMinutes: number;
  habits: Habit[];
  checkins: CheckinMap;
  ctx: CalendarContext;
  rules: ReminderRule[];
  /** keys already fired today (reminder_log) */
  fired: Set<string>;
  endOfDay: string | null;
  startupNudge: boolean;
  startupDelayMin: number;
  appStartedAt: Date;
}

export interface PlannedNotification {
  key: string;
  kind: 'habit' | 'end_of_day' | 'startup';
  habitIds: string[];
  /** reminder whose snooze has now elapsed (to be cleared) */
  clearSnoozeOf?: string;
}

/** Window after a reminder time during which it may still fire (e.g. app opened late). */
const GRACE_MIN = 120;

/**
 * Pure decision: which notifications should fire now. Completed, skipped and rest-day
 * habits never notify, which is how "done cancels the remaining reminders" works.
 */
export function planReminders(i: ReminderPlanInput): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const active = i.habits.filter((h) => !h.archivedAt);
  const isOpen = (h: Habit) => {
    if (!isDue(h, i.today, i.ctx)) return false;
    const s = displayStatus(h, i.today, i.checkins, i.ctx, { today: i.today });
    return s === 'pending' || s === 'overdue' || s === 'active';
  };
  const byId = new Map(active.map((h) => [h.id, h]));

  for (const r of i.rules) {
    const h = byId.get(r.habitId);
    if (!r.enabled || !h || !isOpen(h)) continue;
    const snoozeAt = r.snoozedUntil ? Date.parse(r.snoozedUntil) : null;
    if (snoozeAt != null) {
      if (snoozeAt <= i.now.getTime()) {
        const key = `${r.id}@${r.snoozedUntil}`;
        if (!i.fired.has(key)) out.push({ key, kind: 'habit', habitIds: [h.id], clearSnoozeOf: r.id });
      }
      continue; // a pending snooze suppresses the regular time
    }
    if ((r.kind === 'fixed' || r.kind === 'custom') && r.time && !i.fired.has(r.id)) {
      const at = clockToDayAxis(minutesOf(r.time), i.dayStartMinutes);
      if (i.minuteOfDay >= at && i.minuteOfDay - at < GRACE_MIN) out.push({ key: r.id, kind: 'habit', habitIds: [h.id] });
    }
  }

  const open = active.filter(isOpen);
  if (!open.length) return out;

  const eodAt = i.endOfDay ? clockToDayAxis(minutesOf(i.endOfDay), i.dayStartMinutes) : null;
  if (eodAt != null && !i.fired.has('eod') && i.minuteOfDay >= eodAt && i.minuteOfDay - eodAt < 180) {
    out.push({ key: 'eod', kind: 'end_of_day', habitIds: open.map((h) => h.id) });
  }

  const sinceStart = (i.now.getTime() - i.appStartedAt.getTime()) / 60000;
  if (
    i.startupNudge &&
    !i.fired.has('startup') &&
    sinceStart >= i.startupDelayMin &&
    sinceStart < i.startupDelayMin + 30 &&
    (eodAt == null || i.minuteOfDay < eodAt)
  ) {
    out.push({ key: 'startup', kind: 'startup', habitIds: open.map((h) => h.id) });
  }
  return out;
}
