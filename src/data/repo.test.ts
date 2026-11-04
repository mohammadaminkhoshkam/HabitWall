import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { isDue } from '../core/schedule';
import type { HabitDraft } from '../core/types';
import { migrate } from './migrations';
import { Repo } from './repo';
import { SqlJsDb } from './sqljsDb';

const draft = (over: Partial<HabitDraft> = {}): HabitDraft => ({
  title: 'English',
  description: null,
  category: null,
  icon: '🗣️',
  color: '#e5484d',
  kind: 'count',
  targetValue: 20,
  unit: 'min',
  minValue: 5,
  quickSteps: [5, 10],
  preferredTime: '20:00',
  timeOfDay: 'evening',
  startDay: '2026-10-01',
  endDay: null,
  scheduleKind: 'daily',
  scheduleParams: {},
  reminderTime: '20:00',
  ...over,
});

let repo: Repo;
beforeEach(async () => {
  const SQL = await initSqlJs();
  const db = await SqlJsDb.create(SQL);
  await migrate(db);
  await migrate(db); // idempotent
  repo = new Repo(db);
});

describe('Repo', () => {
  it('creates habits with schedule and reminder', async () => {
    const id = await repo.createHabit(draft());
    const [h] = await repo.listHabits();
    expect(h).toMatchObject({ id, title: 'English', targetValue: 20, minValue: 5, quickSteps: [5, 10] });
    expect(h.schedules).toHaveLength(1);
    expect(await repo.listReminders()).toMatchObject([{ habitId: id, kind: 'fixed', time: '20:00' }]);
  });

  it('logs check-ins, keeps actual values and supports undo', async () => {
    await repo.createHabit(draft());
    const [h] = await repo.listHabits();
    await repo.applyCheckin(h, '2026-10-05', { delta: 10 }, 'tap');
    const { before } = await repo.applyCheckin(h, '2026-10-05', { delta: 35 }, 'tap');
    expect((await repo.getCheckin(h.id, '2026-10-05'))!.value).toBe(45);

    await repo.restoreCheckin(h.id, '2026-10-05', before);
    expect((await repo.getCheckin(h.id, '2026-10-05'))!.value).toBe(10);

    const first = await repo.applyCheckin(h, '2026-10-06', { status: 'done', value: 20 }, 'tap');
    await repo.restoreCheckin(h.id, '2026-10-06', first.before);
    expect(await repo.getCheckin(h.id, '2026-10-06')).toBeNull();

    const events = await repo.listEvents('2026-10-01');
    expect(events.map((e) => e.delta)).toEqual([10, 35, 20]); // undo entries are excluded
  });

  it('versions schedule edits so history keeps its rules', async () => {
    await repo.createHabit(draft());
    let [h] = await repo.listHabits();
    await repo.applyCheckin(h, '2026-10-02', { value: 20 }, 'tap');
    await repo.updateHabit(h, draft({ scheduleKind: 'days_of_week', scheduleParams: { days: [1] }, targetValue: 30 }), '2026-10-06');
    [h] = await repo.listHabits();
    const ctx = { weekendDays: [5], weekStart: 6 };
    expect(h.schedules).toHaveLength(2);
    expect(isDue(h, '2026-10-03', ctx)).toBe(true); // Saturday, old daily rule
    expect(isDue(h, '2026-10-10', ctx)).toBe(false); // Saturday, new Monday-only rule
    expect((await repo.getCheckin(h.id, '2026-10-02'))!.targetSnapshot).toBe(20);
  });

  it('settings, focus, search, delete', async () => {
    await repo.saveSetting('theme', 'blue');
    expect(await repo.loadSettings()).toEqual({ theme: 'blue' });

    const id = await repo.createHabit(draft({ title: 'Gym', description: 'Strength training' }));
    await repo.setFocus('2026-10-05', [id, 'a', 'b', 'c']);
    expect(await repo.getFocus('2026-10-05')).toEqual([id, 'a', 'b']);

    const [h] = await repo.listHabits();
    await repo.applyCheckin(h, '2026-10-05', { note: 'Felt tired at first but good afterward.' }, 'tap');
    await repo.createVoiceNote({ purpose: 'inbox', durationMs: 1000, audioPath: null, text: 'exercise idea', language: 'en', provider: 'test', interpretation: null });
    const hits = await repo.search('tired');
    expect(hits).toMatchObject([{ kind: 'note', ref: id, day: '2026-10-05' }]);
    expect(await repo.search('exercise')).toHaveLength(1);
    expect((await repo.listInbox())[0]).toMatchObject({ inboxState: 'new', text: 'exercise idea' });

    await repo.deleteHabit(id);
    expect(await repo.listHabits()).toHaveLength(0);
    expect(await repo.getCheckin(id, '2026-10-05')).toBeNull(); // cascaded
  });
});
