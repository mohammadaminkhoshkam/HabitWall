import { describe, expect, it } from 'vitest';
import { habit } from '../testkit';
import { parseVoice } from './parse';

const today = '2026-10-05'; // Monday
const english = habit({ id: 'en', title: 'English', unit: 'min', targetValue: 20 });
const exercise = habit({ id: 'ex', title: 'Exercise', unit: 'min', targetValue: 30 });
const reading = habit({ id: 'rd', title: 'Read Book', unit: 'pages', targetValue: 10 });
const ctx = { today, weekStart: 1, habits: [english, exercise, reading] };

describe('voice → habit (create)', () => {
  it('sentence from the spec', () => {
    const r = parseVoice('I want to study English every day at 8 pm for twenty minutes.', ctx);
    expect(r.intent).toBe('create_habit');
    if (r.intent !== 'create_habit') return;
    expect(r.habit).toMatchObject({
      title: 'English',
      scheduleKind: 'daily',
      targetValue: 20,
      unit: 'min',
      preferredTime: '20:00',
      timeOfDay: 'evening',
      startDay: today,
    });
  });

  it('specific weekdays', () => {
    const r = parseVoice('I want to exercise on Monday, Tuesday and Friday for thirty minutes', ctx);
    if (r.intent !== 'create_habit') throw new Error(r.intent);
    expect(r.habit.scheduleKind).toBe('days_of_week');
    expect(r.habit.scheduleParams.days).toEqual([1, 2, 5]);
    expect(r.habit.targetValue).toBe(30);
  });

  it('times per week, every N days, start next week, topic in title', () => {
    const a = parseVoice('I want to go to the gym three times a week', ctx);
    if (a.intent !== 'create_habit') throw new Error(a.intent);
    expect(a.habit.scheduleKind).toBe('times_per_week');
    expect(a.habit.scheduleParams.n).toBe(3);

    const b = parseVoice('I want to meditate every 2 days at 7:30 am', ctx);
    if (b.intent !== 'create_habit') throw new Error(b.intent);
    expect(b.habit).toMatchObject({ scheduleKind: 'every_n_days', preferredTime: '07:30', title: 'Meditation' });

    const c = parseVoice('Starting next week I want to read one article about history every day', ctx);
    if (c.intent !== 'create_habit') throw new Error(c.intent);
    expect(c.habit.startDay).toBe('2026-10-12'); // next Monday-start week
    expect(c.habit.title).toBe('Read Article: history');
    expect(c.habit).toMatchObject({ unit: 'article', targetValue: 1 });
  });

  it('minimum version', () => {
    const r = parseVoice('I want to code fifteen minutes every day, at least 5 minutes', ctx);
    if (r.intent !== 'create_habit') throw new Error(r.intent);
    expect(r.habit).toMatchObject({ scheduleKind: 'daily', targetValue: 15, minValue: 5, icon: '💻' });
  });
});

describe('voice check-in', () => {
  it('"Today I exercised for half an hour" → Exercise 30 min, completed', () => {
    const r = parseVoice('Today I exercised for half an hour', ctx);
    expect(r).toMatchObject({ intent: 'checkin', habitId: 'ex', value: 30, markDone: true, day: today });
  });

  it('"I only studied English for ten minutes" → partial 10/20', () => {
    const r = parseVoice('Today I only studied English for ten minutes', ctx);
    expect(r).toMatchObject({ intent: 'checkin', habitId: 'en', value: 10, markDone: false });
  });

  it('yesterday, unit mismatch is flagged as ambiguous', () => {
    const r = parseVoice('Yesterday I read 12 pages', ctx);
    expect(r).toMatchObject({ intent: 'checkin', habitId: 'rd', value: 12, day: '2026-10-04' });
    const amb = parseVoice('I did it', ctx);
    expect(amb.intent).toBe('checkin');
    if (amb.intent === 'checkin') expect(amb.confidence).toBeLessThan(0.5);
  });

  it('unrelated sentence becomes a note', () => {
    expect(parseVoice('Remember to call Alex', ctx).intent).toBe('note');
  });
});
