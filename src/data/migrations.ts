import type { Db } from './db';

/**
 * Ordered, append-only. Never edit a shipped migration — add a new one.
 * Each migration runs inside one transaction together with its version bump.
 */
export const MIGRATIONS: { version: number; name: string; statements: string[] }[] = [
  {
    version: 1,
    name: 'initial schema',
    statements: [
      `CREATE TABLE habits (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        icon TEXT,
        color TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('check','count')),
        target_value REAL NOT NULL DEFAULT 1,
        unit TEXT,
        min_value REAL,
        quick_steps TEXT NOT NULL DEFAULT '[]',
        preferred_time TEXT,
        time_of_day TEXT NOT NULL DEFAULT 'any' CHECK (time_of_day IN ('morning','afternoon','evening','any')),
        start_day TEXT NOT NULL,
        end_day TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE habit_schedules (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        effective_from TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('daily','weekdays','weekends','days_of_week','times_per_week','every_n_days','days_of_month')),
        params TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (habit_id, effective_from)
      )`,
      `CREATE TABLE checkins (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        status TEXT CHECK (status IN ('done','partial','skipped','rest')),
        value REAL NOT NULL DEFAULT 0,
        target_snapshot REAL NOT NULL,
        active_since TEXT,
        note TEXT,
        tz_offset_min INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (habit_id, day)
      )`,
      `CREATE TABLE progress_events (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        delta REAL,
        status_to TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('fixed','after_startup','end_of_day','custom')),
        time TEXT,
        delay_min INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        snoozed_until TEXT
      )`,
      `CREATE TABLE reminder_log (
        reminder_id TEXT NOT NULL,
        day TEXT NOT NULL,
        fired_at TEXT NOT NULL,
        PRIMARY KEY (reminder_id, day)
      )`,
      `CREATE TABLE voice_notes (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK (purpose IN ('create_habit','checkin','inbox','note')),
        audio_path TEXT,
        duration_ms INTEGER,
        inbox_state TEXT CHECK (inbox_state IN ('new','habit','task','note','deleted')),
        linked_habit_id TEXT REFERENCES habits(id) ON DELETE SET NULL,
        linked_checkin_id TEXT REFERENCES checkins(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE transcripts (
        id TEXT PRIMARY KEY,
        voice_note_id TEXT NOT NULL REFERENCES voice_notes(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        language TEXT,
        provider TEXT NOT NULL,
        interpretation TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE daily_focus (day TEXT PRIMARY KEY, habit_ids TEXT NOT NULL)`,
      `CREATE TABLE weekly_reviews (week_start TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE INDEX idx_checkins_day ON checkins(day)`,
      `CREATE INDEX idx_progress_habit ON progress_events(habit_id, day)`,
      `CREATE INDEX idx_schedules_habit ON habit_schedules(habit_id, effective_from)`,
      `CREATE INDEX idx_reminders_habit ON reminders(habit_id)`,
    ],
  },
];

export async function migrate(db: Db): Promise<number> {
  await db.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const rows = await db.select<{ version: number }>('SELECT MAX(version) AS version FROM schema_version');
  const current = rows[0]?.version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.batch([
      ...m.statements.map((sql) => ({ sql })),
      { sql: 'INSERT INTO schema_version (version) VALUES (?)', params: [m.version] },
    ]);
  }
  return MIGRATIONS[MIGRATIONS.length - 1].version;
}
