import { describe, expect, it } from 'vitest';
import { planReminders, type ReminderPlanInput } from './reminders';
import { buildCheckinMap } from './stats';
import { ck, ctx, habit } from './testkit';

const today = '2026-10-05';
const english = habit({ id: 'en', title: 'English' });

function input(over: Partial<ReminderPlanInput> = {}): ReminderPlanInput {
  return {
    now: new Date(2026, 9, 5, 20, 5),
    today,
    minuteOfDay: (20 - 4) * 60 + 5,
    dayStartMinutes: 240,
    habits: [english],
    checkins: new Map(),
    ctx,
    rules: [{ id: 'r1', habitId: 'en', kind: 'fixed', time: '20:00', enabled: true, snoozedUntil: null }],
    fired: new Set(),
    endOfDay: '21:30',
    startupNudge: false,
    startupDelayMin: 5,
    appStartedAt: new Date(2026, 9, 5, 9, 0),
    ...over,
  };
}

describe('reminder planning', () => {
  it('fires a fixed reminder once, after its time', () => {
    expect(planReminders(input()).map((p) => p.key)).toEqual(['r1']);
    expect(planReminders(input({ fired: new Set(['r1']) }))).toEqual([]);
    expect(planReminders(input({ minuteOfDay: (19 - 4) * 60 }))).toEqual([]);
  });

  it('completing the habit cancels its reminders', () => {
    const checkins = buildCheckinMap([ck(english, today, 20)]);
    expect(planReminders(input({ checkins }))).toEqual([]);
  });

  it('snooze suppresses, then fires when it elapses', () => {
    const rules = [{ id: 'r1', habitId: 'en', kind: 'fixed' as const, time: '20:00', enabled: true, snoozedUntil: '2026-10-05T20:30:00' }];
    expect(planReminders(input({ rules }))).toEqual([]);
    const later = planReminders(input({ rules, now: new Date(2026, 9, 5, 20, 31) }));
    expect(later).toMatchObject([{ kind: 'habit', clearSnoozeOf: 'r1' }]);
  });

  it('end-of-day and startup nudges list open habits', () => {
    const eod = planReminders(input({ rules: [], minuteOfDay: (21 - 4) * 60 + 40 }));
    expect(eod).toMatchObject([{ key: 'eod', habitIds: ['en'] }]);
    const start = planReminders(input({ rules: [], startupNudge: true, now: new Date(2026, 9, 5, 9, 6) }));
    expect(start).toMatchObject([{ key: 'startup' }]);
  });

  it('a reminder at 00:30 with a 04:00 day start belongs to the same logical day', () => {
    const rules = [{ id: 'late', habitId: 'en', kind: 'fixed' as const, time: '00:30', enabled: true, snoozedUntil: null }];
    expect(planReminders(input({ rules, minuteOfDay: (24 - 4) * 60 + 31 }))).toMatchObject([{ key: 'late' }]);
  });
});
