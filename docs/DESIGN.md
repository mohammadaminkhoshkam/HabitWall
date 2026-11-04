# HabitWall — Design (pre-implementation)

Priorities, in order, for every decision below:
**speed of daily use → low friction → visibility → reliability → privacy → beautiful UI.**

---

## 1. Architecture

```
┌──────────────────────────── Tauri 2 shell (Rust) ────────────────────────────┐
│ windows: "widget" (frameless, transparent, always-on-top toggle)             │
│          "dashboard" (normal window, created lazily, hidden on close)        │
│ tray menu · global shortcuts · autostart · notifications · single-instance   │
│ window-state (position/size persisted) · SQLite (tauri-plugin-sql + migrations)│
│ secrets: API keys in OS credential store (keyring) — never sent to the UI    │
│ voice commands: transcribe(audio) / interpret(text) → HTTPS from Rust only   │
└───────────────▲──────────────────────────────────────────────▲───────────────┘
                │ invoke / events                               │ SQL
┌───────────────┴──────────── Frontend (React + TS + Vite) ─────┴───────────────┐
│ ui/        windows (Widget, Dashboard, Onboarding), screens, components       │
│ state/     Zustand stores (per window) — thin cache over repositories         │
│ services/  ReminderScheduler, DayClock (rollover), VoicePipeline, Undo        │
│ data/      Repositories over a `Db` interface (Tauri SQL | sql.js for tests)  │
│ core/      PURE domain logic, no I/O: schedule, logical day, status,          │
│            streak/consistency, weekly review, insights, local voice parser    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Rules
- `core/` is pure TypeScript and fully unit-tested (Vitest). UI never computes stats itself.
- SQLite is the single source of truth. Each window keeps its own store; after any write the
  writer emits a Tauri event `data:changed {tables, day}` and other windows reload the slice.
- Every user action is one short SQL transaction committed immediately (WAL mode) → a crash or
  force-quit loses at most the action in flight. Form drafts autosave to localStorage.
- Window close = hide. The widget window is never destroyed, so its JS context hosts the
  ReminderScheduler and DayClock even when hidden.
- No account, no network unless the user configures a voice/AI provider.

### Rust side
Plugins: `-global-shortcut`, `-autostart`, `-notification`, `-window-state`, `-single-instance`.
Crates: `rusqlite` (bundled SQLite), `keyring` (OS credential store), `reqwest`.

Implementation notes (decided while building):
- SQLite is accessed through a small own bridge (`src-tauri/src/db.rs`: `db_select`, `db_execute`,
  `db_batch`) over a single `rusqlite` connection instead of `tauri-plugin-sql`: the plugin's
  connection pool cannot guarantee that BEGIN…COMMIT run on one connection, and atomic
  multi-statement writes are a core requirement. `PRAGMA synchronous = FULL` + WAL.
- Migrations live in TypeScript (`src/data/migrations.ts`) so the desktop app, unit tests (sql.js)
  and the browser preview share one schema.
- Search uses `LIKE` over habits, notes and transcripts instead of FTS5 — local data volume is tiny
  and it behaves identically in sql.js.
- Rust build output goes to `%LOCALAPPDATA%\habitwall-target` (`src-tauri/.cargo/config.toml`) to
  stay under Windows' 260-character path limit.

---

## 2. Time model (rollover & timezone safety)

- **Logical day** = local calendar date of `(now − dayStartOffset)`; `dayStartOffset` is a
  setting (default 04:00). A 01:30 workout counts for "yesterday".
- History is keyed by the stored string `day = 'YYYY-MM-DD'`, **never recomputed** from
  timestamps. Changing timezone or system clock cannot move past check-ins.
- Timestamps are stored as UTC ISO + `tz_offset_min` for audit/insights only.
- Daily habit instances are **virtual**: `isDue(habit, schedule, day)` decides what appears
  today; a `checkins` row is created on first interaction. "Missed" is derived (due, in the
  past, no done/skip/rest). Consequence: there is no rollover job that can fail — if the app
  was closed at midnight, the next launch simply computes the new day.
- `DayClock` service fires `day:changed` at the next boundary and re-checks on window focus,
  system resume and every 60 s (catches sleep/clock jumps).

---

## 3. Database schema (SQLite, migration v1)

```sql
PRAGMA journal_mode = WAL;  PRAGMA foreign_keys = ON;

CREATE TABLE habits (
  id            TEXT PRIMARY KEY,            -- uuid v7 (sortable)
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  icon          TEXT,                        -- emoji or icon id
  color         TEXT NOT NULL,               -- hex
  kind          TEXT NOT NULL CHECK (kind IN ('check','count')),
  target_value  REAL NOT NULL DEFAULT 1,     -- 20 (min), 10 (pages), 1 (check)
  unit          TEXT,                        -- 'min','pages','glasses','article',…
  min_value     REAL,                        -- "minimum version" (e.g. 5 min)
  quick_steps   TEXT,                        -- JSON [5,10] → +5 / +10 buttons
  preferred_time TEXT,                       -- 'HH:MM'
  time_of_day   TEXT CHECK (time_of_day IN ('morning','afternoon','evening','any')),
  start_day     TEXT NOT NULL,
  end_day       TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  archived_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Versioned: editing a schedule inserts a new row; history keeps using the old one.
CREATE TABLE habit_schedules (
  id             TEXT PRIMARY KEY,
  habit_id       TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  effective_from TEXT NOT NULL,               -- logical day
  kind           TEXT NOT NULL CHECK (kind IN
                  ('daily','weekdays','weekends','days_of_week',
                   'times_per_week','every_n_days','days_of_month')),
  params         TEXT NOT NULL DEFAULT '{}',  -- {"days":[1,3,5]} | {"n":3} | {"dates":[1,15]}
  created_at     TEXT NOT NULL,
  UNIQUE (habit_id, effective_from)
);

CREATE TABLE checkins (                       -- DailyCheckin
  id              TEXT PRIMARY KEY,
  habit_id        TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  day             TEXT NOT NULL,
  status          TEXT CHECK (status IN ('done','partial','skipped','rest')), -- NULL = in progress/none
  value           REAL NOT NULL DEFAULT 0,    -- actual (45 min, 14 pages, 6 glasses)
  target_snapshot REAL NOT NULL,              -- target at that day (edits don't rewrite history)
  active_since    TEXT,                       -- set while "working on it" (blue)
  note            TEXT,
  tz_offset_min   INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (habit_id, day)
);

CREATE TABLE progress_events (                -- HabitProgress: append-only log
  id         TEXT PRIMARY KEY,
  habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  delta      REAL,                            -- +10 min, or NULL for status change
  status_to  TEXT,
  source     TEXT NOT NULL CHECK (source IN ('tap','menu','voice','dashboard','undo')),
  created_at TEXT NOT NULL                    -- feeds time-of-day insights + undo
);

CREATE TABLE reminders (
  id            TEXT PRIMARY KEY,
  habit_id      TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('fixed','after_startup','end_of_day','custom')),
  time          TEXT,                         -- 'HH:MM' for fixed/custom
  delay_min     INTEGER,                      -- after_startup
  enabled       INTEGER NOT NULL DEFAULT 1,
  snoozed_until TEXT
);
CREATE TABLE reminder_log (                   -- dedupe: one fire per reminder per day
  reminder_id TEXT NOT NULL, day TEXT NOT NULL, fired_at TEXT NOT NULL,
  PRIMARY KEY (reminder_id, day)
);

CREATE TABLE voice_notes (                    -- VoiceNote (also the Voice Inbox)
  id              TEXT PRIMARY KEY,
  purpose         TEXT NOT NULL CHECK (purpose IN ('create_habit','checkin','inbox','note')),
  audio_path      TEXT,                       -- only if user chose to keep audio
  duration_ms     INTEGER,
  inbox_state     TEXT CHECK (inbox_state IN ('new','habit','task','note','deleted')),
  linked_habit_id TEXT REFERENCES habits(id) ON DELETE SET NULL,
  linked_checkin_id TEXT REFERENCES checkins(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL
);
CREATE TABLE transcripts (
  id            TEXT PRIMARY KEY,
  voice_note_id TEXT NOT NULL REFERENCES voice_notes(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  language      TEXT,                         -- 'en'
  provider      TEXT NOT NULL,
  interpretation TEXT,                        -- JSON returned by interpreter
  created_at    TEXT NOT NULL
);

CREATE TABLE daily_focus (day TEXT PRIMARY KEY, habit_ids TEXT NOT NULL);  -- Big 3
CREATE TABLE weekly_reviews (week_start TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);         -- JSON values

CREATE INDEX idx_checkins_day   ON checkins(day);
CREATE INDEX idx_progress_habit ON progress_events(habit_id, day);
```

Status semantics (core/status.ts):

| Stored | Today shows | Past day counts as |
|---|---|---|
| none, value 0 | 🔴 Pending (Overdue after preferred time) | Missed |
| none, value > 0 or `active_since` | 🔵 In progress | Partial |
| `done` (or value ≥ target) | 🟢 Completed | Done |
| `partial` | 🔵 | Partial |
| `skipped` / `rest` | ⚪ Gray | Neutral |

Metrics (core/stats.ts):
- **Streak**: walk back over due days; done or value ≥ `min_value` → +1; skipped/rest →
  neutral (doesn't break); missed/below-minimum → stop. Today pending never breaks it.
  `times_per_week` habits count streaks in weeks that met the quota.
- **Consistency (N days)** = Σ credit / due days, credit = min(1, value/target) (done = 1,
  rest excluded from the denominator, skipped = 0).
- Best streak, 7/30-day completion, total completions derived from the same pass.

---

## 4. Screen map

```
First run ─► Onboarding (3 steps: what? · when/how often? · sticky style) ─► Widget

Widget (sticky note, always visible)
 ├─ Header: day name · progress "2/5 · 40%" · 🎤 · ⋯ menu (pin, on-top, theme, hide, dashboard)
 ├─ TODAY'S BIG 3 (large rows)
 ├─ Other habits (compact rows)
 ├─ Done / Skipped (collapsed)
 ├─ Recovery hint row ("Resume today" / "Do 5 min") when a habit was missed
 ├─ Overlays: voice capture · voice preview card · quick-amount popover · context menu · undo toast

Dashboard (Ctrl+Shift+H opens widget; dashboard from tray/menu)
 ├─ Today          — same list, more detail, notes, focus picker
 ├─ Habits         — list ▸ editor (drawer) ▸ delete (confirm) / archive
 ├─ Calendar       — month grid with % per day ▸ day detail
 ├─ Statistics     — per habit: streak, best, consistency, heatmap 7/30/90/365
 ├─ Voice Inbox    — items ▸ Convert to habit / task / keep note / delete
 ├─ Weekly Review  — current + past weeks, trend vs previous week, insights
 ├─ Settings       — general (day start, week start, autostart) · appearance ·
 │                   reminders · shortcuts · voice & AI (provider, key, keep audio) · data (export/import)
 └─ Search (Ctrl+K) — habits, notes, transcripts
Tray: Show/Hide widget · Dashboard · Voice capture · New habit · Pause reminders · Quit
```

---

## 5. Component hierarchy

```
App (router by window label)
├─ WidgetWindow
│  ├─ StickyFrame (theme, drag region, resize grip)
│  │  ├─ WidgetHeader ─ ProgressPill, MicButton, WidgetMenu
│  │  ├─ FocusSection ─ HabitRow[size=lg]
│  │  ├─ HabitList    ─ HabitRow[size=sm]
│  │  │   HabitRow ─ StatusDot, Title, ProgressBar, QuickActions(+5/+10/Done/Skip)
│  │  ├─ CollapsedDone
│  │  └─ RecoveryHint
│  ├─ ContextMenu (Partial, Skip, Rest, Note, Edit, Snooze, Focus)
│  ├─ AmountPopover · VoiceOverlay ─ VoicePreviewCard · UndoToast
├─ DashboardWindow
│  ├─ Sidebar · CommandPalette(Search)
│  └─ TodayScreen · HabitsScreen(HabitEditor) · CalendarScreen(DayDetail)
│     StatsScreen(Heatmap, MetricCards) · InboxScreen · ReviewScreen · SettingsScreen
└─ Onboarding (StepWhat, StepWhen, StepStyle)
Shared ui/: Button, IconButton, Segmented, Field, ColorPicker, IconPicker, FrequencyPicker,
            Drawer, Toast, Menu, Heatmap, Ring
```

---

## 6. State management

- **Zustand** stores per window: `todayStore` (today's computed rows), `habitsStore`,
  `settingsStore`, `uiStore` (popovers, undo stack). Stores call repositories; they never
  hold data that is not in SQLite (except transient UI).
- Optimistic updates: tap → store updates instantly → repository write → on failure, revert
  + error toast.
- Cross-window sync: `emit('data:changed')` → listeners re-query (queries are tiny; a year of
  data for 10 habits is ~3.6k rows).
- Undo: every mutating action returns an inverse operation pushed to `uiStore.undo`; toast
  shows "Undo" for 6 s; `Ctrl+Z` in the widget also works.
- Derived values (status, streak, %) are computed by `core/` selectors, memoized per day.

---

## 7. Voice → Transcript → Habit flow

```
[🎤 / Ctrl+Shift+V] ─► record (MediaRecorder, opus) ─ level meter, auto-stop on 2 s silence/30 s
      │
      ▼
invoke('voice_transcribe', bytes, purpose)            (Rust)
      │  Transcriber trait: OpenAiCompatible{model} | (future) local whisper
      │  API key read from OS keychain inside Rust — never in frontend/bundle
      ▼
voice_notes + transcripts rows saved immediately (nothing is lost if the next step fails)
      │
      ▼
interpret(text, context = {habits, today, locale})
   1) local rule parser (core/voice/parse.ts) — number words ("twenty", "half an hour"),
      times ("8 pm" → 20:00), frequencies ("every day", "Monday and Wednesday",
      "three times a week"), units; fuzzy habit matching (title + aliases)
   2) if AI configured: invoke('voice_interpret') → LLM with JSON schema output
   3) merge; result = { intent: create_habit | checkin | note | unknown, fields, confidence }
      │
      ├─ create_habit ─► Preview card "Create this habit?" (editable fields) ─► Save
      ├─ checkin, confident & unique habit ─► apply + Undo toast  (no confirmation)
      ├─ checkin, ambiguous ─► "Did you mean English (10/20 min)?" ─► Confirm
      └─ inbox / unknown ─► Voice Inbox (Convert to Habit / Task / Note / Delete)
```

Voice works without AI (local parser) and the app works without voice. Provider and model
names are settings, not constants.

---

## 8. Implementation plan (MVP order from the spec)

| # | Milestone | Notes |
|---|---|---|
| 0 | Scaffold Tauri 2 + React + TS + Vite, migrations, `core/` + Vitest | |
| 1 | Habit CRUD + editor + frequency picker | delete = confirm; archive = undo |
| 2 | Daily generation (virtual instances), DayClock, day-start offset | |
| 3 | Sticky widget: frameless, drag, resize, on-top, themes, persisted position | |
| 4 | One-click completion, quick amounts, context menu, undo | < 10 s logging |
| 5 | SQLite persistence hardening (WAL, transactions, crash test) | |
| 6 | Streak + consistency + recovery mode | |
| 7 | Reminders (fixed/startup/end-of-day, snooze, dedupe, cancel on done) | |
| 8 | Tray, autostart, global shortcuts, single instance | |
| 9–11 | Voice capture, transcription, voice-to-habit, voice check-in | local parser first |
| 12–13 | Statistics (heatmaps), Calendar, Weekly review | |
| later | Insights, inbox conversion, search, export, sync | |
