import { describe, expect, it } from 'vitest';
import { addDays, diffDays, logicalDay, nextDayBoundary, startOfWeek, weekday } from './dates';
import { isDue } from './schedule';
import { computeHabitStats, buildCheckinMap, daySummary, heatCell } from './stats';
import { displayStatus, creditOf } from './status';
import { weeklyReview } from './review';
import { ck, ctx, habit } from './testkit';

describe('dates', () => {
  it('logical day respects the custom day start', () => {
    expect(logicalDay(new Date(2026, 9, 5, 1, 30), 240)).toBe('2026-10-04');
    expect(logicalDay(new Date(2026, 9, 5, 4, 0), 240)).toBe('2026-10-05');
    expect(logicalDay(new Date(2026, 9, 5, 0, 0), 0)).toBe('2026-10-05');
  });

  it('day arithmetic is timezone-proof', () => {
    expect(addDays('2026-03-21', 1)).toBe('2026-03-22');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-02-27', '2026-03-02')).toBe(3);
    expect(weekday('2026-10-05')).toBe(1); // Monday
    expect(startOfWeek('2026-10-08', 6)).toBe('2026-10-03'); // Saturday-start week
  });

  it('next boundary is the next day-start moment', () => {
    const b = nextDayBoundary(new Date(2026, 9, 5, 23, 0), 240);
    expect([b.getDate(), b.getHours()]).toEqual([6, 4]);
    const b2 = nextDayBoundary(new Date(2026, 9, 5, 2, 0), 240);
    expect([b2.getDate(), b2.getHours()]).toEqual([5, 4]);
  });
});

describe('schedule', () => {
  it('handles every frequency kind', () => {
    const mwf = habit({}, [{ kind: 'days_of_week', params: { days: [1, 3, 5] } }]);
    expect(isDue(mwf, '2026-10-05', ctx)).toBe(true); // Mon
    expect(isDue(mwf, '2026-10-06', ctx)).toBe(false); // Tue

    const wk = habit({}, [{ kind: 'weekdays' }]);
    expect(isDue(wk, '2026-10-04', ctx)).toBe(false); // Sun
    expect(isDue(wk, '2026-10-05', ctx)).toBe(true);
    // A custom weekend (Friday only) from settings
    expect(isDue(wk, '2026-10-04', { weekendDays: [5], weekStart: 6 })).toBe(true);

    const every3 = habit({ startDay: '2026-10-01' }, [{ kind: 'every_n_days', params: { n: 3 } }]);
    expect(['2026-10-01', '2026-10-02', '2026-10-04'].map((d) => isDue(every3, d, ctx))).toEqual([true, false, true]);

    const dom = habit({}, [{ kind: 'days_of_month', params: { dates: [31] } }]);
    expect(isDue(dom, '2026-09-30', ctx)).toBe(true); // last day of a 30-day month
    expect(isDue(dom, '2026-10-30', ctx)).toBe(false);
  });

  it('uses the schedule version in force on each day', () => {
    const h = habit({ startDay: '2026-09-01' }, [
      { kind: 'daily', effectiveFrom: '2026-09-01' },
      { kind: 'days_of_week', params: { days: [1] }, effectiveFrom: '2026-10-01' },
    ]);
    expect(isDue(h, '2026-09-29', ctx)).toBe(true); // Tue, old daily schedule
    expect(isDue(h, '2026-10-06', ctx)).toBe(false); // Tue, new Monday-only schedule
  });

  it('respects lifetime and archive', () => {
    const h = habit({ startDay: '2026-10-01', endDay: '2026-10-10' });
    expect(isDue(h, '2026-09-30', ctx)).toBe(false);
    expect(isDue(h, '2026-10-11', ctx)).toBe(false);
  });
});

describe('status', () => {
  const today = '2026-10-05';
  it('maps progress to display status', () => {
    const h = habit();
    const m = (v: number, s: any = null) => buildCheckinMap([ck(h, today, v, s)]);
    expect(displayStatus(h, today, new Map(), ctx, { today })).toBe('pending');
    expect(displayStatus(h, today, m(10), ctx, { today })).toBe('active');
    expect(displayStatus(h, today, m(20), ctx, { today })).toBe('done');
    expect(displayStatus(h, today, m(0, 'skipped'), ctx, { today })).toBe('skipped');
    expect(displayStatus(h, '2026-10-04', new Map(), ctx, { today })).toBe('missed');
  });

  it('flags overdue after the preferred time', () => {
    const h = habit({ preferredTime: '20:00' });
    const opts = { today, dayStartMinutes: 240 };
    expect(displayStatus(h, today, new Map(), ctx, { ...opts, minutesIntoToday: (19 - 4) * 60 })).toBe('pending');
    expect(displayStatus(h, today, new Map(), ctx, { ...opts, minutesIntoToday: (21 - 4) * 60 })).toBe('overdue');
  });

  it('credits partial progress, excludes rest days', () => {
    const h = habit();
    expect(creditOf(h, ck(h, today, 14))).toBeCloseTo(0.7);
    expect(creditOf(h, ck(h, today, 0, 'rest'))).toBeNull();
    expect(creditOf(h, ck(h, today, 45))).toBe(1);
  });
});

describe('streak & consistency', () => {
  const today = '2026-10-10';

  it('counts the streak, ignores an unfinished today, and survives rest days', () => {
    const h = habit({ startDay: '2026-10-01' });
    const m = buildCheckinMap([
      ck(h, '2026-10-05', 20),
      ck(h, '2026-10-06', 20),
      ck(h, '2026-10-07', 0, 'rest'),
      ck(h, '2026-10-08', 25),
      ck(h, '2026-10-09', 20),
    ]);
    const s = computeHabitStats(h, m, ctx, today);
    expect(s.currentStreak).toBe(4);
    expect(s.missedRun).toBe(0);
  });

  it('one missed day resets the streak but not the consistency score', () => {
    const h = habit({ startDay: '2026-10-01' });
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    const m = buildCheckinMap(days.map((d) => ck(h, d, 20)));
    const s = computeHabitStats(h, m, ctx, today); // 10-09 missed
    expect(s.currentStreak).toBe(0);
    expect(s.missedRun).toBe(1);
    expect(s.bestStreak).toBe(8);
    expect(s.consistency30).toBeCloseTo(8 / 9);
  });

  it('the minimum version keeps the streak alive', () => {
    const h = habit({ startDay: '2026-10-07', minValue: 5 });
    const m = buildCheckinMap([ck(h, '2026-10-07', 20), ck(h, '2026-10-08', 5), ck(h, '2026-10-09', 20)]);
    const s = computeHabitStats(h, m, ctx, today);
    expect(s.currentStreak).toBe(3);
    expect(s.completion7).toBeCloseTo(2 / 3);
  });

  it('weekly quota habits streak in weeks', () => {
    const h = habit({ startDay: '2026-09-21', kind: 'check', targetValue: 1 }, [{ kind: 'times_per_week', params: { n: 2 } }]);
    const m = buildCheckinMap([
      ck(h, '2026-09-22', 1), ck(h, '2026-09-24', 1), // week of 9/21: met
      ck(h, '2026-09-29', 1), ck(h, '2026-10-01', 1), // week of 9/28: met
      ck(h, '2026-10-06', 1), // current week (10/05): 1 of 2, still pending
    ]);
    const s = computeHabitStats(h, m, ctx, today);
    expect(s.streakUnit).toBe('week');
    expect(s.currentStreak).toBe(2);
  });

  it('heatmap and calendar summaries', () => {
    const h = habit({ startDay: '2026-10-01' });
    const m = buildCheckinMap([ck(h, '2026-10-08', 20), ck(h, '2026-10-09', 7)]);
    expect(heatCell(h, '2026-10-08', m, ctx, today)).toEqual({ kind: 'level', level: 4 });
    expect(heatCell(h, '2026-10-09', m, ctx, today)).toEqual({ kind: 'level', level: 2 });
    expect(heatCell(h, '2026-10-07', m, ctx, today)).toEqual({ kind: 'miss' });
    expect(heatCell(h, '2026-10-11', m, ctx, today)).toEqual({ kind: 'future' });
    const h2 = habit({ startDay: '2026-10-01', kind: 'check', targetValue: 1 });
    const m2 = buildCheckinMap([ck(h, '2026-10-08', 20), ck(h2, '2026-10-08', 0)]);
    expect(daySummary([h, h2], '2026-10-08', m2, ctx)).toMatchObject({ due: 2, done: 1, ratio: 0.5 });
  });
});

describe('weekly review', () => {
  it('summarises the week with best / needs attention / trend', () => {
    const a = habit({ title: 'English', startDay: '2026-09-01' });
    const b = habit({ title: 'Reading', startDay: '2026-09-01' });
    const week = '2026-10-05'; // Monday
    const cks = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(week, i);
      cks.push(ck(a, d, 20));
      if (i < 2) cks.push(ck(b, d, 20));
    }
    const r = weeklyReview([a, b], week, buildCheckinMap(cks), ctx, '2026-10-12');
    expect(r.rows.find((x) => x.habitId === a.id)).toMatchObject({ done: 7, due: 7 });
    expect(r.rows.find((x) => x.habitId === b.id)).toMatchObject({ done: 2, due: 7 });
    expect(r.bestHabitId).toBe(a.id);
    expect(r.needsAttentionId).toBe(b.id);
    expect(r.previousOverall).toBe(0);
    expect(r.trend).toBeCloseTo(9 / 14);
  });
});
