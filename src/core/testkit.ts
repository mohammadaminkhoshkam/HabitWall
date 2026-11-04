// Test helpers (only imported from *.test.ts).
import type { Checkin, CheckinStatus, Habit, ScheduleKind, ScheduleParams } from './types';

let seq = 0;

export function habit(over: Partial<Habit> & { kind?: Habit['kind'] } = {}, sched?: {
  kind: ScheduleKind;
  params?: ScheduleParams;
  effectiveFrom?: string;
}[]): Habit {
  const id = over.id ?? `h${++seq}`;
  const startDay = over.startDay ?? '2026-09-01';
  return {
    id,
    title: 'Habit',
    description: null,
    category: null,
    icon: null,
    color: '#e5484d',
    kind: 'count',
    targetValue: 20,
    unit: 'min',
    minValue: null,
    quickSteps: [5, 10],
    preferredTime: null,
    timeOfDay: 'any',
    startDay,
    endDay: null,
    sortOrder: 0,
    archivedAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over,
    schedules: (sched ?? [{ kind: 'daily' }]).map((s, i) => ({
      id: `${id}-s${i}`,
      habitId: id,
      effectiveFrom: s.effectiveFrom ?? startDay,
      kind: s.kind,
      params: s.params ?? {},
    })),
  };
}

export function ck(h: Habit, day: string, value: number, status: CheckinStatus | null = null): Checkin {
  return {
    id: `${h.id}-${day}`,
    habitId: h.id,
    day,
    status,
    value,
    targetSnapshot: h.targetValue,
    activeSince: null,
    note: null,
    tzOffsetMin: 0,
    createdAt: `${day}T10:00:00Z`,
    updatedAt: `${day}T10:00:00Z`,
  };
}

export const ctx = { weekendDays: [0, 6], weekStart: 1 };
