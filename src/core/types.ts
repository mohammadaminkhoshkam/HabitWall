/** Logical day, 'YYYY-MM-DD'. Stored as-is; never recomputed from timestamps. */
export type Day = string;

export type HabitKind = 'check' | 'count';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'any';

export type ScheduleKind =
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'days_of_week'
  | 'times_per_week'
  | 'every_n_days'
  | 'days_of_month';

export interface ScheduleParams {
  /** days_of_week: 0 = Sunday … 6 = Saturday */
  days?: number[];
  /** times_per_week / every_n_days */
  n?: number;
  /** days_of_month: 1..31 */
  dates?: number[];
}

export interface Schedule {
  id: string;
  habitId: string;
  effectiveFrom: Day;
  kind: ScheduleKind;
  params: ScheduleParams;
}

export interface Habit {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  color: string;
  kind: HabitKind;
  targetValue: number;
  unit: string | null;
  /** "Minimum version" – doing at least this keeps the streak alive. */
  minValue: number | null;
  quickSteps: number[];
  preferredTime: string | null; // 'HH:MM'
  timeOfDay: TimeOfDay;
  startDay: Day;
  endDay: Day | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Sorted ascending by effectiveFrom. Never empty for a saved habit. */
  schedules: Schedule[];
}

export type CheckinStatus = 'done' | 'partial' | 'skipped' | 'rest';

export interface Checkin {
  id: string;
  habitId: string;
  day: Day;
  status: CheckinStatus | null;
  value: number;
  targetSnapshot: number;
  activeSince: string | null;
  note: string | null;
  tzOffsetMin: number;
  createdAt: string;
  updatedAt: string;
}

/** What the UI shows for a habit on a given day. */
export type DisplayStatus =
  | 'pending' // red: due, nothing done yet
  | 'overdue' // red, emphasised: past preferred time
  | 'active' // blue: in progress
  | 'done' // green
  | 'partial' // past day, some progress
  | 'skipped' // gray
  | 'rest' // gray
  | 'missed' // past day, nothing
  | 'week_done' // times_per_week quota already met this week
  | 'not_due';

export interface CalendarContext {
  /** 0 = Sunday … 6 = Saturday */
  weekendDays: number[];
  weekStart: number;
}

export type CheckinMap = Map<string, Checkin>; // key: `${habitId}|${day}`

/** Everything needed to create a habit (editor form, onboarding, voice preview). */
export interface HabitDraft {
  title: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  color: string;
  kind: HabitKind;
  targetValue: number;
  unit: string | null;
  minValue: number | null;
  quickSteps: number[];
  preferredTime: string | null;
  timeOfDay: TimeOfDay;
  startDay: Day;
  endDay: Day | null;
  scheduleKind: ScheduleKind;
  scheduleParams: ScheduleParams;
  reminderTime: string | null;
}

export const checkinKey = (habitId: string, day: Day) => `${habitId}|${day}`;
