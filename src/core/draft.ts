import { scheduleFor } from './schedule';
import type { Day, Habit, HabitDraft } from './types';
import { defaultSteps } from './units';
import type { ParsedHabit } from './voice/parse';

export const HABIT_COLORS = ['#e5484d', '#f76b15', '#f5a524', '#30a46c', '#12a594', '#3e63dd', '#6e56cf', '#d6409f', '#8b8d98'];
export const HABIT_ICONS = ['🗣️', '🏋️', '📰', '📖', '💧', '🧘', '🚶', '🏃', '💻', '📚', '✍️', '🌙', '🥗', '🎸', '🧹', '💊', '🙏', '🎯'];

export function emptyDraft(today: Day, colorIndex = 0): HabitDraft {
  return {
    title: '',
    description: null,
    category: null,
    icon: null,
    color: HABIT_COLORS[colorIndex % HABIT_COLORS.length],
    kind: 'check',
    targetValue: 1,
    unit: null,
    minValue: null,
    quickSteps: [],
    preferredTime: null,
    timeOfDay: 'any',
    startDay: today,
    endDay: null,
    scheduleKind: 'daily',
    scheduleParams: {},
    reminderTime: null,
  };
}

export function draftFromHabit(h: Habit, today: Day, reminderTime: string | null): HabitDraft {
  const s = scheduleFor(h, today);
  return {
    title: h.title,
    description: h.description,
    category: h.category,
    icon: h.icon,
    color: h.color,
    kind: h.kind,
    targetValue: h.targetValue,
    unit: h.unit,
    minValue: h.minValue,
    quickSteps: h.quickSteps,
    preferredTime: h.preferredTime,
    timeOfDay: h.timeOfDay,
    startDay: h.startDay,
    endDay: h.endDay,
    scheduleKind: s.kind,
    scheduleParams: s.params,
    reminderTime,
  };
}

export function draftFromParsed(p: ParsedHabit, colorIndex = 0): HabitDraft {
  return {
    ...emptyDraft(p.startDay, colorIndex),
    title: p.title,
    icon: p.icon,
    kind: p.kind,
    targetValue: p.targetValue,
    unit: p.unit,
    minValue: p.minValue,
    quickSteps: p.quickSteps.length ? p.quickSteps : p.kind === 'count' ? defaultSteps(p.unit, p.targetValue) : [],
    preferredTime: p.preferredTime,
    timeOfDay: p.timeOfDay,
    startDay: p.startDay,
    scheduleKind: p.scheduleKind,
    scheduleParams: p.scheduleParams,
    // A habit with a time gets a reminder at that time by default.
    reminderTime: p.preferredTime,
  };
}

export function validateDraft(d: HabitDraft): Partial<Record<keyof HabitDraft, true>> {
  const e: Partial<Record<keyof HabitDraft, true>> = {};
  if (!d.title.trim()) e.title = true;
  if (d.kind === 'count' && !(d.targetValue > 0)) e.targetValue = true;
  if (d.minValue != null && (d.minValue <= 0 || (d.kind === 'count' && d.minValue >= d.targetValue))) e.minValue = true;
  if (d.scheduleKind === 'days_of_week' && !d.scheduleParams.days?.length) e.scheduleParams = true;
  if ((d.scheduleKind === 'times_per_week' || d.scheduleKind === 'every_n_days') && !(Number(d.scheduleParams.n) >= 1)) e.scheduleParams = true;
  if (d.scheduleKind === 'days_of_month' && !d.scheduleParams.dates?.length) e.scheduleParams = true;
  if (d.endDay && d.endDay < d.startDay) e.endDay = true;
  return e;
}
