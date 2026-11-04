import { addDays, weekday } from '../core/dates';
import { isDue } from '../core/schedule';
import type { CalendarContext, Day, HabitDraft } from '../core/types';
import type { Repo } from './repo';
import type { Stmt } from './db';

const DEMO: Partial<HabitDraft>[] = [
  { title: 'Learn English', icon: '🗣️', color: '#e5484d', kind: 'count', targetValue: 20, unit: 'min', minValue: 5, quickSteps: [5, 10], preferredTime: '20:00', timeOfDay: 'evening', reminderTime: '20:00' },
  { title: 'Exercise', icon: '🏋️', color: '#f76b15', kind: 'count', targetValue: 30, unit: 'min', minValue: 5, quickSteps: [10, 15], scheduleKind: 'days_of_week', scheduleParams: { days: [1, 3, 5] }, timeOfDay: 'morning' },
  { title: 'Read One Article', icon: '📰', color: '#3e63dd', kind: 'count', targetValue: 1, unit: 'article', quickSteps: [] },
  { title: 'Read Book', icon: '📖', color: '#6e56cf', kind: 'count', targetValue: 10, unit: 'pages', minValue: 2, quickSteps: [5, 10], timeOfDay: 'evening' },
  { title: 'Drink Water', icon: '💧', color: '#12a594', kind: 'count', targetValue: 8, unit: 'glasses', quickSteps: [1] },
];

/** Deterministic pseudo-random so the demo looks the same every time. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * Creates the five demo habits with three weeks of plausible history,
 * so streaks, heatmaps and the weekly review have something to show.
 */
export async function createDemo(repo: Repo, today: Day, ctx: CalendarContext, withHistory = true) {
  const start = withHistory ? addDays(today, -35) : today;
  const created = new Set<string>();
  for (const d of DEMO) {
    const id = await repo.createHabit({
      title: '', description: null, category: null, icon: null, color: '#e5484d', kind: 'check', targetValue: 1,
      unit: null, minValue: null, quickSteps: [], preferredTime: null, timeOfDay: 'any', startDay: start, endDay: null,
      scheduleKind: 'daily', scheduleParams: {}, reminderTime: null,
      ...d,
    } as HabitDraft);
    created.add(id);
  }
  if (!withHistory) return;

  const habits = (await repo.listHabits()).filter((h) => created.has(h.id));
  const rand = rng(42);
  const stmts: Stmt[] = [];
  const tz = -new Date().getTimezoneOffset();
  for (const h of habits) {
    for (let d = start; d < today; d = addDays(d, 1)) {
      if (!isDue(h, d, ctx)) continue;
      const r = rand();
      // Fridays are weaker for exercise — gives the insights something real to find.
      const friday = weekday(d) === 5 && h.icon === '🏋️';
      let value = 0;
      if (r < (friday ? 0.2 : 0.72)) value = h.targetValue + (h.unit === 'min' && r < 0.2 ? 10 : 0);
      else if (r < 0.88) value = Math.max(h.minValue ?? 0, Math.round(h.targetValue * (0.3 + rand() * 0.4)));
      if (!value) continue;
      const hour = h.timeOfDay === 'morning' ? 8 : h.timeOfDay === 'evening' ? 20 : 13;
      const ts = new Date(`${d}T${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 59)).padStart(2, '0')}:00`).toISOString();
      stmts.push(
        {
          sql: `INSERT INTO checkins (id, habit_id, day, status, value, target_snapshot, tz_offset_min, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)`,
          params: [crypto.randomUUID(), h.id, d, value >= h.targetValue ? 'done' : null, value, h.targetValue, tz, ts, ts],
        },
        {
          sql: "INSERT INTO progress_events (id, habit_id, day, delta, status_to, source, created_at) VALUES (?,?,?,?,NULL,'tap',?)",
          params: [crypto.randomUUID(), h.id, d, value, ts],
        },
      );
    }
  }
  await repo.db.batch(stmts);
}
