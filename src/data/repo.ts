import { scheduleFor } from '../core/schedule';
import type {
  Checkin,
  CheckinStatus,
  Day,
  Habit,
  HabitDraft,
  Schedule,
  ScheduleKind,
} from '../core/types';
import type { Db, SqlValue, Stmt } from './db';

export const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const tzOffset = () => -new Date().getTimezoneOffset();
const json = (v: unknown) => JSON.stringify(v);
function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------ row mapping

type Row = Record<string, SqlValue>;

function toHabit(r: Row, schedules: Schedule[]): Habit {
  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    category: (r.category as string) ?? null,
    icon: (r.icon as string) ?? null,
    color: r.color as string,
    kind: r.kind as Habit['kind'],
    targetValue: Number(r.target_value),
    unit: (r.unit as string) ?? null,
    minValue: r.min_value == null ? null : Number(r.min_value),
    quickSteps: parseJson<number[]>(r.quick_steps, []),
    preferredTime: (r.preferred_time as string) ?? null,
    timeOfDay: (r.time_of_day as Habit['timeOfDay']) ?? 'any',
    startDay: r.start_day as string,
    endDay: (r.end_day as string) ?? null,
    sortOrder: Number(r.sort_order),
    archivedAt: (r.archived_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    schedules,
  };
}

function toSchedule(r: Row): Schedule {
  return {
    id: r.id as string,
    habitId: r.habit_id as string,
    effectiveFrom: r.effective_from as string,
    kind: r.kind as ScheduleKind,
    params: parseJson(r.params, {}),
  };
}

function toCheckin(r: Row): Checkin {
  return {
    id: r.id as string,
    habitId: r.habit_id as string,
    day: r.day as string,
    status: (r.status as CheckinStatus) ?? null,
    value: Number(r.value),
    targetSnapshot: Number(r.target_snapshot),
    activeSince: (r.active_since as string) ?? null,
    note: (r.note as string) ?? null,
    tzOffsetMin: Number(r.tz_offset_min),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

const UPSERT_CHECKIN = `INSERT INTO checkins
  (id, habit_id, day, status, value, target_snapshot, active_since, note, tz_offset_min, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(habit_id, day) DO UPDATE SET
    status = excluded.status, value = excluded.value, active_since = excluded.active_since,
    note = excluded.note, target_snapshot = excluded.target_snapshot, updated_at = excluded.updated_at`;

function checkinParams(c: Checkin): SqlValue[] {
  return [c.id, c.habitId, c.day, c.status, c.value, c.targetSnapshot, c.activeSince, c.note, c.tzOffsetMin, c.createdAt, c.updatedAt];
}

// ------------------------------------------------------------------ public types

export interface CheckinPatch {
  /** add to value (count habits / timer) */
  delta?: number;
  /** absolute value */
  value?: number;
  status?: CheckinStatus | null;
  activeSince?: string | null;
  note?: string | null;
}

export type ProgressSource = 'tap' | 'menu' | 'voice' | 'dashboard' | 'undo' | 'timer';

export interface ProgressEvent {
  habitId: string;
  day: Day;
  delta: number | null;
  statusTo: string | null;
  source: ProgressSource;
  createdAt: string;
}

export interface Reminder {
  id: string;
  habitId: string;
  kind: 'fixed' | 'after_startup' | 'end_of_day' | 'custom';
  time: string | null;
  delayMin: number | null;
  enabled: boolean;
  snoozedUntil: string | null;
}

export type InboxState = 'new' | 'habit' | 'task' | 'note' | 'deleted';

export interface VoiceNote {
  id: string;
  purpose: 'create_habit' | 'checkin' | 'inbox' | 'note';
  audioPath: string | null;
  durationMs: number | null;
  inboxState: InboxState | null;
  linkedHabitId: string | null;
  createdAt: string;
  text: string | null;
  language: string | null;
  interpretation: unknown;
}

export interface SearchHit {
  kind: 'habit' | 'note' | 'transcript';
  ref: string;
  day: Day | null;
  text: string;
}

// ------------------------------------------------------------------ repository

export class Repo {
  constructor(readonly db: Db) {}

  // ---------- habits

  async listHabits(): Promise<Habit[]> {
    const [rows, srows] = await Promise.all([
      this.db.select<Row>('SELECT * FROM habits ORDER BY sort_order, created_at'),
      this.db.select<Row>('SELECT * FROM habit_schedules ORDER BY effective_from'),
    ]);
    const byHabit = new Map<string, Schedule[]>();
    for (const r of srows) {
      const s = toSchedule(r);
      (byHabit.get(s.habitId) ?? byHabit.set(s.habitId, []).get(s.habitId)!).push(s);
    }
    return rows
      .map((r) => toHabit(r, byHabit.get(r.id as string) ?? []))
      .filter((h) => h.schedules.length > 0);
  }

  async createHabit(d: HabitDraft): Promise<string> {
    const id = uid();
    const t = nowIso();
    const order = await this.db.select<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM habits');
    const stmts: Stmt[] = [
      {
        sql: `INSERT INTO habits (id, title, description, category, icon, color, kind, target_value, unit, min_value,
              quick_steps, preferred_time, time_of_day, start_day, end_day, sort_order, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [
          id, d.title.trim(), d.description, d.category, d.icon, d.color, d.kind,
          d.kind === 'check' ? 1 : d.targetValue, d.kind === 'check' ? null : d.unit, d.minValue,
          json(d.quickSteps), d.preferredTime, d.timeOfDay, d.startDay, d.endDay, order[0]?.n ?? 1, t, t,
        ],
      },
      {
        sql: 'INSERT INTO habit_schedules (id, habit_id, effective_from, kind, params, created_at) VALUES (?,?,?,?,?,?)',
        params: [uid(), id, d.startDay, d.scheduleKind, json(d.scheduleParams), t],
      },
    ];
    if (d.reminderTime) {
      stmts.push({
        sql: "INSERT INTO reminders (id, habit_id, kind, time, enabled) VALUES (?,?, 'fixed', ?, 1)",
        params: [uid(), id, d.reminderTime],
      });
    }
    await this.db.batch(stmts);
    return id;
  }

  /**
   * Schedule changes are versioned from `today` so past days keep the rules they had.
   * A habit with no history yet simply gets its schedule replaced.
   */
  async updateHabit(habit: Habit, d: HabitDraft, today: Day): Promise<void> {
    const t = nowIso();
    const stmts: Stmt[] = [
      {
        sql: `UPDATE habits SET title=?, description=?, category=?, icon=?, color=?, kind=?, target_value=?, unit=?,
              min_value=?, quick_steps=?, preferred_time=?, time_of_day=?, start_day=?, end_day=?, updated_at=? WHERE id=?`,
        params: [
          d.title.trim(), d.description, d.category, d.icon, d.color, d.kind,
          d.kind === 'check' ? 1 : d.targetValue, d.kind === 'check' ? null : d.unit, d.minValue,
          json(d.quickSteps), d.preferredTime, d.timeOfDay, d.startDay, d.endDay, t, habit.id,
        ],
      },
    ];

    const current = scheduleFor(habit, today);
    const changed = current.kind !== d.scheduleKind || json(current.params) !== json(d.scheduleParams);
    const history = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM checkins WHERE habit_id = ?', [habit.id]);
    if (!history[0]?.n || habit.startDay !== d.startDay) {
      stmts.push(
        { sql: 'DELETE FROM habit_schedules WHERE habit_id = ?', params: [habit.id] },
        {
          sql: 'INSERT INTO habit_schedules (id, habit_id, effective_from, kind, params, created_at) VALUES (?,?,?,?,?,?)',
          params: [uid(), habit.id, d.startDay, d.scheduleKind, json(d.scheduleParams), t],
        },
      );
    } else if (changed) {
      const from = today > d.startDay ? today : d.startDay;
      stmts.push({
        sql: `INSERT INTO habit_schedules (id, habit_id, effective_from, kind, params, created_at) VALUES (?,?,?,?,?,?)
              ON CONFLICT(habit_id, effective_from) DO UPDATE SET kind = excluded.kind, params = excluded.params`,
        params: [uid(), habit.id, from, d.scheduleKind, json(d.scheduleParams), t],
      });
    }

    // A new target applies from today; history keeps its snapshot.
    stmts.push({
      sql: 'UPDATE checkins SET target_snapshot = ? WHERE habit_id = ? AND day >= ?',
      params: [d.kind === 'check' ? 1 : d.targetValue, habit.id, today],
    });

    stmts.push({ sql: "DELETE FROM reminders WHERE habit_id = ? AND kind = 'fixed'", params: [habit.id] });
    if (d.reminderTime) {
      stmts.push({
        sql: "INSERT INTO reminders (id, habit_id, kind, time, enabled) VALUES (?,?, 'fixed', ?, 1)",
        params: [uid(), habit.id, d.reminderTime],
      });
    }
    await this.db.batch(stmts);
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    await this.db.execute('UPDATE habits SET archived_at = ?, updated_at = ? WHERE id = ?', [
      archived ? nowIso() : null,
      nowIso(),
      id,
    ]);
  }

  async deleteHabit(id: string): Promise<void> {
    await this.db.batch([
      { sql: 'DELETE FROM reminder_log WHERE reminder_id IN (SELECT id FROM reminders WHERE habit_id = ?)', params: [id] },
      { sql: 'DELETE FROM habits WHERE id = ?', params: [id] },
    ]);
  }

  async reorder(ids: string[]): Promise<void> {
    await this.db.batch(ids.map((id, i) => ({ sql: 'UPDATE habits SET sort_order = ? WHERE id = ?', params: [i + 1, id] })));
  }

  // ---------- check-ins

  async listCheckins(from: Day, to: Day): Promise<Checkin[]> {
    const rows = await this.db.select<Row>('SELECT * FROM checkins WHERE day >= ? AND day <= ?', [from, to]);
    return rows.map(toCheckin);
  }

  async getCheckin(habitId: string, day: Day): Promise<Checkin | null> {
    const rows = await this.db.select<Row>('SELECT * FROM checkins WHERE habit_id = ? AND day = ?', [habitId, day]);
    return rows[0] ? toCheckin(rows[0]) : null;
  }

  /** Applies a change and logs it. Returns the before-state so callers can offer Undo. */
  async applyCheckin(
    habit: Habit,
    day: Day,
    patch: CheckinPatch,
    source: ProgressSource,
  ): Promise<{ before: Checkin | null; after: Checkin }> {
    const before = await this.getCheckin(habit.id, day);
    const t = nowIso();
    const after: Checkin = before
      ? { ...before }
      : {
          id: uid(),
          habitId: habit.id,
          day,
          status: null,
          value: 0,
          targetSnapshot: habit.kind === 'check' ? 1 : habit.targetValue,
          activeSince: null,
          note: null,
          tzOffsetMin: tzOffset(),
          createdAt: t,
          updatedAt: t,
        };
    if (patch.value !== undefined) after.value = Math.max(0, patch.value);
    if (patch.delta !== undefined) after.value = Math.max(0, Math.round((after.value + patch.delta) * 100) / 100);
    if (patch.status !== undefined) after.status = patch.status;
    if (patch.activeSince !== undefined) after.activeSince = patch.activeSince;
    if (patch.note !== undefined) after.note = patch.note?.trim() || null;
    after.updatedAt = t;

    const delta = after.value - (before?.value ?? 0);
    const statusChanged = after.status !== (before?.status ?? null);
    const stmts: Stmt[] = [{ sql: UPSERT_CHECKIN, params: checkinParams(after) }];
    if (delta !== 0 || statusChanged) {
      stmts.push({
        sql: 'INSERT INTO progress_events (id, habit_id, day, delta, status_to, source, created_at) VALUES (?,?,?,?,?,?,?)',
        params: [uid(), habit.id, day, delta || null, statusChanged ? after.status ?? 'cleared' : null, source, t],
      });
    }
    await this.db.batch(stmts);
    return { before, after };
  }

  /** Undo: put a check-in back exactly as it was (or remove it). */
  async restoreCheckin(habitId: string, day: Day, before: Checkin | null): Promise<void> {
    const stmts: Stmt[] = before
      ? [{ sql: UPSERT_CHECKIN, params: checkinParams(before) }]
      : [{ sql: 'DELETE FROM checkins WHERE habit_id = ? AND day = ?', params: [habitId, day] }];
    stmts.push({
      sql: "INSERT INTO progress_events (id, habit_id, day, delta, status_to, source, created_at) VALUES (?,?,?,NULL,'restored','undo',?)",
      params: [uid(), habitId, day, nowIso()],
    });
    await this.db.batch(stmts);
  }

  async listEvents(fromDay: Day): Promise<ProgressEvent[]> {
    const rows = await this.db.select<Row>(
      "SELECT * FROM progress_events WHERE day >= ? AND source != 'undo' ORDER BY created_at",
      [fromDay],
    );
    return rows.map((r) => ({
      habitId: r.habit_id as string,
      day: r.day as string,
      delta: r.delta == null ? null : Number(r.delta),
      statusTo: (r.status_to as string) ?? null,
      source: r.source as ProgressSource,
      createdAt: r.created_at as string,
    }));
  }

  // ---------- focus (Big 3)

  async getFocus(day: Day): Promise<string[]> {
    const rows = await this.db.select<Row>('SELECT habit_ids FROM daily_focus WHERE day = ?', [day]);
    return parseJson<string[]>(rows[0]?.habit_ids, []);
  }

  async setFocus(day: Day, ids: string[]): Promise<void> {
    await this.db.execute(
      'INSERT INTO daily_focus (day, habit_ids) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET habit_ids = excluded.habit_ids',
      [day, json(ids.slice(0, 3))],
    );
  }

  // ---------- settings

  async loadSettings(): Promise<Record<string, unknown>> {
    const rows = await this.db.select<Row>('SELECT key, value FROM settings');
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key as string] = parseJson(r.value, null);
    return out;
  }

  async saveSetting(key: string, value: unknown): Promise<void> {
    await this.db.execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, json(value)],
    );
  }

  // ---------- reminders

  async listReminders(): Promise<Reminder[]> {
    const rows = await this.db.select<Row>('SELECT * FROM reminders');
    return rows.map((r) => ({
      id: r.id as string,
      habitId: r.habit_id as string,
      kind: r.kind as Reminder['kind'],
      time: (r.time as string) ?? null,
      delayMin: r.delay_min == null ? null : Number(r.delay_min),
      enabled: !!r.enabled,
      snoozedUntil: (r.snoozed_until as string) ?? null,
    }));
  }

  async firedReminders(day: Day): Promise<Set<string>> {
    const rows = await this.db.select<Row>('SELECT reminder_id FROM reminder_log WHERE day = ?', [day]);
    return new Set(rows.map((r) => r.reminder_id as string));
  }

  /** Returns false if it was already logged (another window fired it first). */
  async logReminder(reminderId: string, day: Day): Promise<boolean> {
    const n = await this.db.execute(
      'INSERT OR IGNORE INTO reminder_log (reminder_id, day, fired_at) VALUES (?,?,?)',
      [reminderId, day, nowIso()],
    );
    return n > 0;
  }

  async snoozeHabitReminders(habitId: string, until: string | null): Promise<void> {
    await this.db.execute('UPDATE reminders SET snoozed_until = ? WHERE habit_id = ?', [until, habitId]);
  }

  // ---------- voice

  async createVoiceNote(v: {
    purpose: VoiceNote['purpose'];
    durationMs: number | null;
    audioPath: string | null;
    text: string;
    language: string | null;
    provider: string;
    interpretation: unknown;
  }): Promise<string> {
    const id = uid();
    const t = nowIso();
    await this.db.batch([
      {
        sql: 'INSERT INTO voice_notes (id, purpose, audio_path, duration_ms, inbox_state, created_at) VALUES (?,?,?,?,?,?)',
        params: [id, v.purpose, v.audioPath, v.durationMs, v.purpose === 'inbox' ? 'new' : null, t],
      },
      {
        sql: 'INSERT INTO transcripts (id, voice_note_id, text, language, provider, interpretation, created_at) VALUES (?,?,?,?,?,?,?)',
        params: [uid(), id, v.text, v.language, v.provider, json(v.interpretation ?? null), t],
      },
    ]);
    return id;
  }

  async setVoiceNoteOutcome(id: string, patch: { inboxState?: InboxState; habitId?: string | null; checkinId?: string | null }) {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (patch.inboxState !== undefined) (sets.push('inbox_state = ?'), params.push(patch.inboxState));
    if (patch.habitId !== undefined) (sets.push('linked_habit_id = ?'), params.push(patch.habitId));
    if (patch.checkinId !== undefined) (sets.push('linked_checkin_id = ?'), params.push(patch.checkinId));
    if (!sets.length) return;
    await this.db.execute(`UPDATE voice_notes SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async listInbox(): Promise<VoiceNote[]> {
    const rows = await this.db.select<Row>(
      `SELECT v.*, t.text, t.language, t.interpretation FROM voice_notes v
       LEFT JOIN transcripts t ON t.voice_note_id = v.id
       WHERE v.inbox_state IS NOT NULL AND v.inbox_state != 'deleted'
       ORDER BY v.created_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id as string,
      purpose: r.purpose as VoiceNote['purpose'],
      audioPath: (r.audio_path as string) ?? null,
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
      inboxState: (r.inbox_state as InboxState) ?? null,
      linkedHabitId: (r.linked_habit_id as string) ?? null,
      createdAt: r.created_at as string,
      text: (r.text as string) ?? null,
      language: (r.language as string) ?? null,
      interpretation: parseJson(r.interpretation, null),
    }));
  }

  async updateTranscript(voiceNoteId: string, text: string): Promise<void> {
    await this.db.execute('UPDATE transcripts SET text = ? WHERE voice_note_id = ?', [text, voiceNoteId]);
  }

  // ---------- weekly reviews

  async saveReview(weekStart: Day, data: unknown): Promise<void> {
    await this.db.execute(
      `INSERT INTO weekly_reviews (week_start, data, created_at) VALUES (?,?,?)
       ON CONFLICT(week_start) DO UPDATE SET data = excluded.data`,
      [weekStart, json(data), nowIso()],
    );
  }

  // ---------- search

  async search(q: string, limit = 50): Promise<SearchHit[]> {
    const term = q.trim();
    if (!term) return [];
    const like = `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const rows = await this.db.select<Row>(
      `SELECT 'habit' AS kind, id AS ref, NULL AS day, title || COALESCE(' — ' || description, '') AS text
         FROM habits WHERE title LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\' OR category LIKE ?1 ESCAPE '\\'
       UNION ALL
       SELECT 'note', habit_id, day, note FROM checkins WHERE note LIKE ?1 ESCAPE '\\'
       UNION ALL
       SELECT 'transcript', t.voice_note_id, substr(t.created_at, 1, 10), t.text
         FROM transcripts t JOIN voice_notes v ON v.id = t.voice_note_id
         WHERE t.text LIKE ?1 ESCAPE '\\' AND COALESCE(v.inbox_state, '') != 'deleted'
       ORDER BY day DESC LIMIT ?2`,
      [like, limit],
    );
    return rows.map((r) => ({
      kind: r.kind as SearchHit['kind'],
      ref: r.ref as string,
      day: (r.day as string) ?? null,
      text: (r.text as string) ?? '',
    }));
  }

  // ---------- export

  async exportAll(): Promise<Record<string, unknown[]>> {
    const tables = ['habits', 'habit_schedules', 'checkins', 'progress_events', 'reminders', 'voice_notes', 'transcripts', 'daily_focus', 'weekly_reviews', 'settings'];
    const out: Record<string, unknown[]> = {};
    for (const t of tables) out[t] = await this.db.select(`SELECT * FROM ${t}`);
    return out;
  }
}
