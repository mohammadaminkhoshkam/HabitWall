/*
 * Offline interpreter for spoken/typed sentences.
 * It covers the common shapes ("every day at 8 pm twenty minutes of English", "I ran 30 min today").
 * When an AI provider is configured its result is merged on top (see services/voice.ts).
 */
import { addDays, hhmm, startOfWeek } from '../dates';
import type { Day, Habit, ScheduleKind, ScheduleParams, TimeOfDay } from '../types';
import { UNIT_PATTERNS, defaultSteps, isUnitKey, type UnitKey } from '../units';

export interface ParsedHabit {
  title: string;
  icon: string | null;
  kind: 'check' | 'count';
  targetValue: number;
  unit: string | null;
  minValue: number | null;
  quickSteps: number[];
  scheduleKind: ScheduleKind;
  scheduleParams: ScheduleParams;
  preferredTime: string | null;
  timeOfDay: TimeOfDay;
  startDay: Day;
}

export type VoiceIntent =
  | { intent: 'create_habit'; habit: ParsedHabit; confidence: number }
  | {
      intent: 'checkin';
      habitId: string | null;
      candidates: string[];
      /** amount in the habit's unit; null = just "done" */
      value: number | null;
      markDone: boolean;
      day: Day;
      confidence: number;
    }
  | { intent: 'note'; text: string; confidence: number };

// ---------------------------------------------------------------- normalization

export function normalize(input: string): string {
  // "20min" → "20 min", "min20" → "min 20"; sentence punctuation becomes a space (but not in 7:30 or 1.5)
  const s = input
    .toLowerCase()
    .replace(/\ba\.m\.?/g, 'am')
    .replace(/\bp\.m\.?/g, 'pm')
    .replace(/(?<!\d)[.,!?;]|[.,!?;](?!\d)/g, ' ')
    .replace(/(\d)([^\d\s.:,/])/g, '$1 $2')
    .replace(/([^\d\s.:,/])(\d)/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

const NUMBER_WORDS: [string, number][] = [
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7],
  ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14],
  ['fifteen', 15], ['sixteen', 16], ['seventeen', 17], ['eighteen', 18], ['nineteen', 19],
  ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70],
  ['eighty', 80], ['ninety', 90], ['hundred', 100],
];

function replaceNumberWords(s: string): string {
  const words = [...NUMBER_WORDS].sort((a, b) => b[0].length - a[0].length);
  for (const [w, n] of words) s = s.replace(new RegExp(`\\b${w}\\b`, 'g'), String(n));
  // "twenty five" / "twenty-five" → 25
  s = s.replace(/\b([2-9]0)[ -]([1-9])(?![\d.])/g, (_, t, u) => String(+t + +u));
  // "half an hour" before "an hour"; then "an hour and a half" → 1.5 hour
  s = s.replace(/\bhalf an hour\b|\bhalf hour\b/g, '0.5 hour');
  s = s.replace(/\ban hour\b/g, '1 hour');
  s = s.replace(/(\d+(?:\.\d+)?) (hours?) and a half/g, (_, n, u) => `${+n + 0.5} ${u}`);
  s = s.replace(/\b(a )?quarter of an hour\b|\b(a )?quarter hour\b/g, '15 min');
  s = s.replace(/\btwice\b/g, '2 times').replace(/\bonce\b/g, '1 times');
  s = s.replace(/\b(a|an) (article|page|glass|cup|chapter)\b/g, '1 $2');
  return s;
}

// ---------------------------------------------------------------- extraction helpers

class Cursor {
  constructor(public s: string) {}
  /** Run regex; if it matches, blank the matched span and return the match. */
  take(re: RegExp): RegExpMatchArray | null {
    const m = this.s.match(re);
    if (m && m.index != null) {
      this.s = (this.s.slice(0, m.index) + ' ' + this.s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    }
    return m;
  }
  has(re: RegExp) {
    return re.test(this.s);
  }
}

const WEEKDAY_NAMES: [RegExp, number][] = [
  [/\bsundays?\b|\bsun\b/, 0], [/\bmondays?\b|\bmon\b/, 1], [/\btuesdays?\b|\btues?\b/, 2],
  [/\bwednesdays?\b|\bwed\b/, 3], [/\bthursdays?\b|\bthurs?\b|\bthu\b/, 4],
  [/\bfridays?\b|\bfri\b/, 5], [/\bsaturdays?\b|\bsat\b/, 6],
];

function takeWeekdays(c: Cursor): number[] {
  const days: number[] = [];
  for (const [re, d] of WEEKDAY_NAMES) while (c.take(re)) if (!days.includes(d)) days.push(d);
  return days.sort((a, b) => a - b);
}

interface Frequency {
  kind: ScheduleKind;
  params: ScheduleParams;
}

function takeFrequency(c: Cursor): Frequency | null {
  let m;
  if ((m = c.take(/(\d+) (times?|days?) (a|per|each) week/))) return { kind: 'times_per_week', params: { n: +m[1] } };
  if ((m = c.take(/every (\d+) days/))) return { kind: 'every_n_days', params: { n: +m[1] } };
  if (c.take(/every other day/)) return { kind: 'every_n_days', params: { n: 2 } };
  if (c.take(/\b(every |on )?weekdays?\b|\bworkdays\b/)) return { kind: 'weekdays', params: {} };
  if (c.take(/\b(every |on )?weekends?\b/)) return { kind: 'weekends', params: {} };
  if (c.take(/\bevery ?day\b|\bdaily\b|\beach day\b/)) return { kind: 'daily', params: {} };
  // "every morning" → daily; the time-of-day word is left for takeBucket.
  if (c.has(/\bevery (morning|night|evening|afternoon)\b/)) return { kind: 'daily', params: {} };
  return null;
}

interface ClockTime {
  minutes: number;
  bucket: TimeOfDay;
}

function bucketOf(min: number): TimeOfDay {
  if (min < 12 * 60) return 'morning';
  if (min < 17 * 60) return 'afternoon';
  return 'evening';
}

function to24(h: number, mod: string | undefined, globalMod: string | null): number {
  const m = mod ?? globalMod ?? '';
  if (/am|a\.m\.|morning/.test(m)) return h === 12 ? 0 : h;
  if (/pm|p\.m\.|afternoon|evening/.test(m)) return h < 12 ? h + 12 : h;
  if (/night|tonight/.test(m)) {
    if (h === 12) return 0;
    return h <= 3 ? h : h < 12 ? h + 12 : h;
  }
  return h;
}

function takeTime(c: Cursor): ClockTime | null {
  const globalMod = c.s.match(/\bmorning\b|\bafternoon\b|\bevening\b|\bnight\b|\btonight\b/)?.[0] ?? null;
  let m;
  // "8 pm", "at 7:30 am"
  if ((m = c.take(/\b(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)/))) {
    const min = to24(+m[1], m[3], null) * 60 + (m[2] ? +m[2] : 0);
    if (min >= 1440) return null;
    return { minutes: min, bucket: bucketOf(min) };
  }
  // "at 8" (with "in the evening" elsewhere), "20:30"
  if ((m = c.take(/\bat (\d{1,2})(?::(\d{2}))?\b/)) || (m = c.take(/\b(\d{1,2}):(\d{2})\b/))) {
    const min = to24(+m[1], undefined, globalMod) * 60 + (m[2] ? +m[2] : 0);
    if (min >= 1440) return null;
    return { minutes: min, bucket: bucketOf(min) };
  }
  return null;
}

function takeBucket(c: Cursor): TimeOfDay | null {
  if (c.take(/\b(every |in the )?mornings?\b/)) return 'morning';
  if (c.take(/\b(every |in the )?afternoons?\b/)) return 'afternoon';
  if (c.take(/\b(every |at |in the )?(evenings?|nights?)\b|\btonight\b/)) return 'evening';
  return null;
}

interface Quantity {
  value: number;
  unit: UnitKey;
}

/** First "<number> <unit>" in the text; hours become minutes. */
function takeQuantity(c: Cursor): Quantity | null {
  const re = /(\d+(?:\.\d+)?) ?([^\s\d]+)/g;
  let m;
  while ((m = re.exec(c.s))) {
    const word = m[2];
    let unit: UnitKey | null = null;
    let factor = 1;
    if (UNIT_PATTERNS.hour.test(word)) [unit, factor] = ['min', 60];
    else for (const [k, p] of Object.entries(UNIT_PATTERNS)) if (k !== 'hour' && p.test(word)) unit = k as UnitKey;
    if (unit) {
      c.s = (c.s.slice(0, m.index) + ' ' + c.s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
      return { value: Math.round(+m[1] * factor * 100) / 100, unit };
    }
  }
  return null;
}

function takeMinimum(c: Cursor): number | null {
  const m = c.take(/(?:at least|minimum|min version) (\d+(?:\.\d+)?)/);
  return m ? +m[1] : null;
}

function takeStart(c: Cursor, today: Day, weekStart: number): Day | null {
  if (c.take(/\b(from |starting )?tomorrow\b/)) return addDays(today, 1);
  if (c.take(/\b(from |starting )?next week\b/)) return addDays(startOfWeek(today, weekStart), 7);
  if (c.take(/\b(from |starting )?next month\b/)) {
    const [y, mo] = today.split('-').map(Number);
    return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  }
  return null;
}

// ---------------------------------------------------------------- activity aliases

interface Alias {
  key: string;
  re: RegExp;
  title: string;
  icon: string;
  unit: UnitKey | null;
  topic?: boolean;
}

export const ALIASES: Alias[] = [
  { key: 'english', re: /\benglish\b|\blanguage\b/, title: 'English', icon: '🗣️', unit: 'min' },
  { key: 'exercise', re: /\bexercis\w*|\bworkout\b|\bwork out\b|\bworked out\b|\bgym\b/, title: 'Exercise', icon: '🏋️', unit: 'min' },
  { key: 'article', re: /\barticles?\b|\bpapers?\b/, title: 'Read Article', icon: '📰', unit: 'article', topic: true },
  { key: 'book', re: /\bbooks?\b/, title: 'Read Book', icon: '📖', unit: 'pages', topic: true },
  { key: 'water', re: /\bwater\b/, title: 'Drink Water', icon: '💧', unit: 'glasses' },
  { key: 'meditation', re: /\bmeditat\w*/, title: 'Meditation', icon: '🧘', unit: 'min' },
  { key: 'walk', re: /\bwalk\w*/, title: 'Walk', icon: '🚶', unit: 'min' },
  { key: 'run', re: /\brun\b|\bran\b|\brunning\b|\bjog\w*/, title: 'Run', icon: '🏃', unit: 'min' },
  { key: 'code', re: /\bcod(e|ing)\b|\bprogramming\b/, title: 'Coding', icon: '💻', unit: 'min' },
  { key: 'study', re: /\bstud(y|ied|ying)\b/, title: 'Study', icon: '📚', unit: 'min', topic: true },
  { key: 'journal', re: /\bjournal\w*/, title: 'Journal', icon: '✍️', unit: null },
  { key: 'sleep', re: /\bsleep\b|\bbed\b/, title: 'Sleep on time', icon: '🌙', unit: null },
];

export function aliasOf(text: string): Alias | null {
  const n = normalize(text);
  return ALIASES.find((a) => a.re.test(n)) ?? null;
}

// ---------------------------------------------------------------- intent cues

const CHECKIN_CUE =
  /\b(did|done|read|ran|walked|drank|finished|completed|studied|practiced|exercised|meditated|wrote|worked out|went)\b/;
const CREATE_CUE =
  /\b(i )?(want|wanna|would like|will|'ll|plan|going) to\b|\bi'll\b|\bnew habit\b|\bstart\b|\bhabit\b/;
const ONLY_CUE = /\bonly\b|\bjust\b/;

const STOP =
  /\b(i|want|wanna|would|like|to|will|i'll|plan|going|every|at|for|the|a|an|and|do|minutes|habit|start|new|some|my|of|read|about)\b/g;

function cleanTitle(rest: string): string {
  return rest.replace(STOP, ' ').replace(/[.,!?:]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- main entry

export interface ParseContext {
  today: Day;
  weekStart: number;
  habits: Habit[];
  /** purpose of the recording – biases ambiguous sentences */
  purpose?: 'create_habit' | 'checkin' | 'inbox' | 'auto';
}

export function parseVoice(input: string, ctx: ParseContext): VoiceIntent {
  const norm = replaceNumberWords(normalize(input));
  const c = new Cursor(norm);

  const isCheckinCue = CHECKIN_CUE.test(norm);
  const isCreateCue = CREATE_CUE.test(norm);

  let dayOffset = 0;
  if (c.take(/\byesterday\b/)) dayOffset = -1;
  c.take(/\btoday\b/);

  const start = takeStart(c, ctx.today, ctx.weekStart);
  const days = takeWeekdays(c);
  const freq = takeFrequency(c) ?? (days.length ? { kind: 'days_of_week' as const, params: { days } } : null);
  const time = takeTime(c);
  const bucket = time?.bucket ?? takeBucket(c);
  const minimum = takeMinimum(c);
  const qty = takeQuantity(c);
  const alias = ALIASES.find((a) => a.re.test(norm)) ?? null;

  const wantsCheckin =
    ctx.purpose === 'checkin' || (isCheckinCue && !isCreateCue && ctx.purpose !== 'create_habit');
  const wantsCreate =
    ctx.purpose === 'create_habit' || (!wantsCheckin && (isCreateCue || !!freq) && (!!alias || !!qty || !!freq));

  if (wantsCheckin) {
    const { best, candidates, score } = matchHabit(norm, ctx.habits);
    const habit = ctx.habits.find((h) => h.id === best) ?? null;
    let value: number | null = null;
    if (qty) value = habit && habit.unit && isUnitKey(habit.unit) && habit.unit !== qty.unit ? null : qty.value;
    const only = ONLY_CUE.test(norm);
    const markDone = value == null ? !only : !!habit && value >= habit.targetValue;
    const ambiguous = !habit || candidates.length > 1 || (qty != null && value == null);
    return {
      intent: 'checkin',
      habitId: habit?.id ?? null,
      candidates,
      value,
      markDone,
      day: addDays(ctx.today, dayOffset),
      confidence: ambiguous ? 0.4 : Math.min(0.95, 0.6 + score * 0.1),
    };
  }

  if (wantsCreate) {
    const rest = cleanTitle(c.s);
    let title: string;
    if (alias) {
      title = alias.title;
      if (alias.topic) {
        const topic = cleanTitle(rest.replace(new RegExp(alias.re.source, 'g'), ' '));
        if (topic && topic.split(' ').length <= 3) title = `${title}: ${topic}`;
      }
    } else {
      title = rest.split(' ').slice(0, 5).join(' ');
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }
    const unit = qty?.unit ?? alias?.unit ?? null;
    const isCount = !!qty || (!!unit && unit !== 'times');
    const target = qty?.value ?? 1;
    const schedule = freq ?? { kind: 'daily' as const, params: {} };
    return {
      intent: 'create_habit',
      habit: {
        title: title || 'New habit',
        icon: alias?.icon ?? null,
        kind: isCount ? 'count' : 'check',
        targetValue: target,
        unit: isCount ? unit : null,
        minValue: minimum,
        quickSteps: isCount ? defaultSteps(unit, target) : [],
        scheduleKind: schedule.kind,
        scheduleParams: schedule.params,
        preferredTime: time ? hhmm(time.minutes) : null,
        timeOfDay: bucket ?? 'any',
        startDay: start ?? ctx.today,
      },
      confidence: (alias || rest ? 0.5 : 0.3) + (freq ? 0.2 : 0) + (qty ? 0.15 : 0) + (time ? 0.1 : 0),
    };
  }

  return { intent: 'note', text: input.trim(), confidence: 0.5 };
}

/** Score habits against a sentence: shared alias + overlapping title words. */
export function matchHabit(
  normText: string,
  habits: Habit[],
): { best: string | null; candidates: string[]; score: number } {
  const textAlias = ALIASES.filter((a) => a.re.test(normText)).map((a) => a.key);
  const scored = habits
    .filter((h) => !h.archivedAt)
    .map((h) => {
      const title = normalize(h.title);
      let score = 0;
      for (const a of ALIASES) if (textAlias.includes(a.key) && a.re.test(title)) score += 3;
      for (const w of title.split(' ')) if (w.length >= 3 && normText.includes(w)) score += 2;
      return { id: h.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { best: null, candidates: [], score: 0 };
  const top = scored[0].score;
  const tied = scored.filter((x) => x.score === top).map((x) => x.id);
  return { best: tied.length === 1 ? tied[0] : null, candidates: tied, score: top };
}
