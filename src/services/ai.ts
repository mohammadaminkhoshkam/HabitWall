/*
 * Provider-agnostic prompt + JSON schema for turning a transcript into an intent.
 * The HTTP call happens in Rust (voice_interpret) so the key never reaches the webview.
 */
import { addDays } from '../core/dates';
import type { Day, Habit, ScheduleKind, TimeOfDay } from '../core/types';
import { defaultSteps } from '../core/units';
import type { ParsedHabit, VoiceIntent } from '../core/voice/parse';

const SCHEDULE_KINDS: ScheduleKind[] = ['daily', 'weekdays', 'weekends', 'days_of_week', 'times_per_week', 'every_n_days', 'days_of_month'];
const TODS: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'any'];

const habitSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'icon', 'kind', 'targetValue', 'unit', 'minValue', 'scheduleKind', 'days', 'n', 'dates', 'preferredTime', 'timeOfDay', 'startDay'],
  properties: {
    title: { type: 'string' },
    icon: { type: ['string', 'null'], description: 'one emoji' },
    kind: { type: 'string', enum: ['check', 'count'] },
    targetValue: { type: 'number' },
    unit: { type: ['string', 'null'] },
    minValue: { type: ['number', 'null'] },
    scheduleKind: { type: 'string', enum: SCHEDULE_KINDS },
    days: { type: 'array', items: { type: 'integer' } },
    n: { type: ['integer', 'null'] },
    dates: { type: 'array', items: { type: 'integer' } },
    preferredTime: { type: ['string', 'null'] },
    timeOfDay: { type: 'string', enum: TODS },
    startDay: { type: ['string', 'null'] },
  },
};

const checkinSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['habitId', 'value', 'markDone', 'day'],
  properties: {
    habitId: { type: ['string', 'null'] },
    value: { type: ['number', 'null'] },
    markDone: { type: 'boolean' },
    day: { type: 'string' },
  },
};

export const INTERPRET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'confidence', 'habit', 'checkin'],
  properties: {
    intent: { type: 'string', enum: ['create_habit', 'checkin', 'note'] },
    confidence: { type: 'number' },
    habit: { anyOf: [habitSchema, { type: 'null' }] },
    checkin: { anyOf: [checkinSchema, { type: 'null' }] },
  },
};

export interface InterpretContext {
  today: Day;
  weekdayName: string;
  weekStart: number;
  habits: Habit[];
  purpose: 'create_habit' | 'checkin' | 'inbox' | 'auto';
}

export function buildInterpretPrompt(text: string, c: InterpretContext) {
  const list = c.habits
    .filter((h) => !h.archivedAt)
    .map((h) => `${h.id} | ${h.title} | ${h.kind === 'check' ? 'yes/no' : h.unit ?? ''} | ${h.kind === 'check' ? 1 : h.targetValue}`)
    .join('\n');
  const system = `You turn short voice notes for a personal habit tracker into structured data.
Notes are in English.
Today is ${c.today} (${c.weekdayName}). Weekday numbers: 0=Sunday … 6=Saturday. The user's week starts on day ${c.weekStart}.

Existing habits (id | title | unit | daily goal):
${list || '(none)'}

Rules:
- intent "create_habit": the user wants to start doing something regularly. Fill "habit", set "checkin" to null.
- intent "checkin": the user reports something they did. Use a habitId from the list only (null if unclear).
  "value" is in that habit's unit (convert hours to minutes when the unit is min). markDone = true if they
  say they finished or value >= the goal. "day" is YYYY-MM-DD (yesterday = ${addDays(c.today, -1)}). "habit" = null.
- Anything else: intent "note", habit = null, checkin = null.
- Units: prefer min, pages, glasses, article, times, km, steps, words, chapters; otherwise a short word.
- kind "check" for yes/no habits (targetValue 1, unit null), "count" when there is an amount.
- Title: short, in title case.
- preferredTime: 24h "HH:MM" or null ("8 pm" = 20:00). startDay: YYYY-MM-DD or null for today.
- days: weekday numbers for days_of_week, else []. n: count for times_per_week / every_n_days, else null.
- dates: days of month for days_of_month, else [].
- confidence: 0..1 — how sure you are about the intent and the fields.
The user pressed the "${c.purpose}" button.`;
  return { system, user: text, schema: INTERPRET_SCHEMA };
}

type AiHabit = {
  title: string; icon: string | null; kind: 'check' | 'count'; targetValue: number; unit: string | null;
  minValue: number | null; scheduleKind: ScheduleKind; days: number[]; n: number | null; dates: number[];
  preferredTime: string | null; timeOfDay: TimeOfDay; startDay: string | null;
};
type AiResult = {
  intent: 'create_habit' | 'checkin' | 'note';
  confidence: number;
  habit: AiHabit | null;
  checkin: { habitId: string | null; value: number | null; markDone: boolean; day: string } | null;
};

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Validates the model output; returns null if it cannot be trusted. */
export function fromAiResult(raw: string, text: string, c: Pick<InterpretContext, 'today' | 'habits'>): VoiceIntent | null {
  let r: AiResult;
  try {
    r = JSON.parse(raw);
  } catch {
    return null;
  }
  const confidence = Math.max(0, Math.min(1, Number(r.confidence) || 0));

  if (r.intent === 'create_habit' && r.habit?.title) {
    const h = r.habit;
    const kind = h.kind === 'check' ? 'check' : 'count';
    const target = kind === 'check' ? 1 : Math.max(0.1, Number(h.targetValue) || 1);
    const unit = kind === 'check' ? null : h.unit || null;
    const scheduleKind = SCHEDULE_KINDS.includes(h.scheduleKind) ? h.scheduleKind : 'daily';
    const habit: ParsedHabit = {
      title: h.title.trim().slice(0, 80),
      icon: h.icon ? [...h.icon].slice(0, 2).join('') : null,
      kind,
      targetValue: target,
      unit,
      minValue: h.minValue && h.minValue > 0 && h.minValue < target ? h.minValue : null,
      quickSteps: kind === 'count' ? defaultSteps(unit, target) : [],
      scheduleKind,
      scheduleParams:
        scheduleKind === 'days_of_week'
          ? { days: [...new Set(h.days.filter((d) => d >= 0 && d <= 6))].sort() }
          : scheduleKind === 'times_per_week' || scheduleKind === 'every_n_days'
            ? { n: Math.max(1, Math.min(scheduleKind === 'times_per_week' ? 7 : 365, h.n ?? 1)) }
            : scheduleKind === 'days_of_month'
              ? { dates: h.dates.filter((d) => d >= 1 && d <= 31) }
              : {},
      preferredTime: isTime(h.preferredTime) ? h.preferredTime : null,
      timeOfDay: TODS.includes(h.timeOfDay) ? h.timeOfDay : 'any',
      startDay: isDay(h.startDay) && h.startDay >= c.today ? h.startDay : c.today,
    };
    if (habit.scheduleKind === 'days_of_week' && !habit.scheduleParams.days?.length) habit.scheduleKind = 'daily';
    return { intent: 'create_habit', habit, confidence };
  }

  if (r.intent === 'checkin' && r.checkin) {
    const known = c.habits.some((h) => h.id === r.checkin!.habitId);
    const day = isDay(r.checkin.day) && r.checkin.day <= c.today ? r.checkin.day : c.today;
    return {
      intent: 'checkin',
      habitId: known ? r.checkin.habitId : null,
      candidates: known ? [r.checkin.habitId!] : [],
      value: typeof r.checkin.value === 'number' && r.checkin.value >= 0 ? r.checkin.value : null,
      markDone: !!r.checkin.markDone,
      day,
      confidence: known ? confidence : Math.min(confidence, 0.4),
    };
  }

  if (r.intent === 'note') return { intent: 'note', text, confidence };
  return null;
}
