/*
 * User-facing operations. Each one writes through the repository, updates the local store,
 * tells the other window, and (for routine actions) offers Undo instead of asking first.
 */
import { hhmm, minutesOf } from '../core/dates';
import { isComplete, targetOf } from '../core/status';
import type { Checkin, CheckinStatus, Day, Habit, HabitDraft } from '../core/types';
import { checkinKey } from '../core/types';
import type { CheckinPatch, ProgressSource } from '../data/repo';
import { mergeSettings, type Settings } from '../data/settings';
import { broadcast, host, setAutostart } from '../platform';
import { getRepo, loadFocus, loadHabits, toast, toastError, useApp } from './store';

function putCheckin(habitId: string, day: Day, c: Checkin | null) {
  useApp.setState((s) => {
    const m = new Map(s.checkins);
    if (c) m.set(checkinKey(habitId, day), c);
    else m.delete(checkinKey(habitId, day));
    return { checkins: m };
  });
}

const t = () => useApp.getState().i18n;
const sync = (scope: 'habits' | 'checkins' | 'settings' | 'focus' | 'inbox' | 'all') =>
  void broadcast({ type: 'data', scope }).catch(() => {});

async function change(
  habit: Habit,
  patch: CheckinPatch,
  message: string | null,
  opts: { day?: Day; source?: ProgressSource } = {},
): Promise<Checkin | null> {
  const day = opts.day ?? useApp.getState().today;
  try {
    const repo = getRepo();
    const { before, after } = await repo.applyCheckin(habit, day, patch, opts.source ?? 'tap');
    putCheckin(habit.id, day, after);
    sync('checkins');
    if (!isComplete(habit, before) && isComplete(habit, after)) {
      useApp.setState({ celebrate: habit.id });
      setTimeout(() => useApp.getState().celebrate === habit.id && useApp.setState({ celebrate: null }), 900);
    }
    if (message) {
      toast(message, async () => {
        await repo.restoreCheckin(habit.id, day, before);
        putCheckin(habit.id, day, before);
        sync('checkins');
        toast(t().t('undone'));
      });
    }
    return after;
  } catch (e) {
    toastError(e);
    return null;
  }
}

const current = (habit: Habit, day?: Day) =>
  useApp.getState().checkins.get(checkinKey(habit.id, day ?? useApp.getState().today)) ?? null;

/** Single click: complete, or un-complete if already done. */
export function tapHabit(habit: Habit, day?: Day) {
  const c = current(habit, day);
  if (isComplete(habit, c) || c?.status === 'skipped' || c?.status === 'rest') return resetHabit(habit, day);
  return change(
    habit,
    { status: 'done', value: Math.max(c?.value ?? 0, targetOf(habit, c)), activeSince: null },
    t().t('toastDone', { title: habit.title }),
    { day },
  );
}

export function addAmount(habit: Habit, amount: number, source: ProgressSource = 'tap', day?: Day) {
  const unit = habit.unit;
  return change(habit, { delta: amount }, t().t('toastLogged', { title: habit.title, v: t().amount(amount, unit) }), { day, source });
}

export function setAmount(habit: Habit, value: number, markDone: boolean, source: ProgressSource = 'tap', day?: Day) {
  const status: CheckinStatus | null = markDone ? 'done' : null;
  return change(habit, { value, status }, t().t('toastLogged', { title: habit.title, v: t().amount(value, habit.unit) }), { day, source });
}

export function setStatus(habit: Habit, status: CheckinStatus, day?: Day) {
  const key = status === 'skipped' ? 'toastSkipped' : status === 'rest' ? 'toastRest' : status === 'partial' ? 'toastPartial' : 'toastDone';
  const patch: CheckinPatch = { status, activeSince: null };
  if (status === 'done') patch.value = Math.max(current(habit, day)?.value ?? 0, targetOf(habit, current(habit, day)));
  return change(habit, patch, t().t(key, { title: habit.title }), { day, source: 'menu' });
}

export function resetHabit(habit: Habit, day?: Day) {
  return change(habit, { status: null, value: 0, activeSince: null }, t().t('toastReset', { title: habit.title }), { day, source: 'menu' });
}

export function doMinimum(habit: Habit) {
  const c = current(habit);
  if (habit.kind === 'check' || !habit.minValue) return tapHabit(habit);
  return change(habit, { value: Math.max(c?.value ?? 0, habit.minValue) }, t().t('toastLogged', { title: habit.title, v: t().amount(habit.minValue, habit.unit) }));
}

export function startTimer(habit: Habit) {
  return change(habit, { activeSince: new Date().toISOString() }, null, { source: 'timer' });
}

export function stopTimer(habit: Habit) {
  const c = current(habit);
  if (!c?.activeSince) return;
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(c.activeSince)) / 60000));
  return change(habit, { activeSince: null, delta: minutes }, t().t('toastLogged', { title: habit.title, v: t().amount(minutes, 'min') }), { source: 'timer' });
}

export function setNote(habit: Habit, note: string, day?: Day) {
  return change(habit, { note }, t().t('toastNote'), { day, source: 'menu' });
}

export async function snoozeHabit(habit: Habit, minutes: number | 'tonight') {
  let until: Date;
  if (minutes === 'tonight') {
    until = new Date();
    const target = Math.max(minutesOf('20:00'), until.getHours() * 60 + until.getMinutes() + 30);
    until.setHours(Math.floor(target / 60), target % 60, 0, 0);
  } else {
    until = new Date(Date.now() + minutes * 60_000);
  }
  try {
    const repo = getRepo();
    const reminders = (await repo.listReminders()).filter((r) => r.habitId === habit.id);
    if (!reminders.length) {
      await repo.db.execute("INSERT INTO reminders (id, habit_id, kind, time, enabled) VALUES (?, ?, 'custom', NULL, 1)", [
        crypto.randomUUID(),
        habit.id,
      ]);
    }
    await repo.snoozeHabitReminders(habit.id, until.toISOString());
    toast(`${t().t('toastSnoozed')} · ${t().time(hhmm(until.getHours() * 60 + until.getMinutes()))}`);
  } catch (e) {
    toastError(e);
  }
}

export async function toggleFocus(habitId: string) {
  const { focus, today } = useApp.getState();
  const next = focus.includes(habitId) ? focus.filter((id) => id !== habitId) : [...focus, habitId].slice(-3);
  useApp.setState({ focus: next });
  try {
    await getRepo().setFocus(today, next);
    sync('focus');
  } catch (e) {
    toastError(e);
    await loadFocus();
  }
}

// ------------------------------------------------------------------ habits

export async function createHabit(draft: HabitDraft, quiet = false): Promise<string | null> {
  try {
    const id = await getRepo().createHabit(draft);
    await loadHabits();
    sync('habits');
    if (!quiet) {
      toast(t().t('toastCreated', { title: draft.title }), async () => {
        await getRepo().deleteHabit(id);
        await loadHabits();
        sync('habits');
      });
    }
    return id;
  } catch (e) {
    toastError(e);
    return null;
  }
}

export async function saveHabit(habit: Habit, draft: HabitDraft) {
  try {
    await getRepo().updateHabit(habit, draft, useApp.getState().today);
    await loadHabits();
    sync('all');
    toast(t().t('toastSaved'));
  } catch (e) {
    toastError(e);
  }
}

export async function archiveHabit(habit: Habit, archived = true) {
  try {
    await getRepo().setArchived(habit.id, archived);
    await loadHabits();
    sync('habits');
    if (archived) {
      toast(t().t('toastArchived', { title: habit.title }), async () => {
        await getRepo().setArchived(habit.id, false);
        await loadHabits();
        sync('habits');
      });
    }
  } catch (e) {
    toastError(e);
  }
}

/** Permanent. The UI must confirm first. */
export async function deleteHabit(habit: Habit) {
  try {
    await getRepo().deleteHabit(habit.id);
    useApp.setState((s) => ({ focus: s.focus.filter((id) => id !== habit.id) }));
    await loadHabits();
    sync('all');
  } catch (e) {
    toastError(e);
  }
}

export async function reorderHabits(ids: string[]) {
  try {
    await getRepo().reorder(ids);
    await loadHabits();
    sync('habits');
  } catch (e) {
    toastError(e);
  }
}

// ------------------------------------------------------------------ settings

export async function updateSettings(patch: Partial<Settings>) {
  const prev = useApp.getState().settings;
  const next = mergeSettings(prev, patch as Record<string, unknown>);
  useApp.setState({ settings: next });
  try {
    const repo = getRepo();
    for (const key of Object.keys(patch) as (keyof Settings)[]) await repo.saveSetting(key, next[key]);
    if (patch.autostart !== undefined && patch.autostart !== prev.autostart) await setAutostart(next.autostart);
    if (patch.widgetMode && useApp.getState().windowKind === 'widget') await host.setWidgetMode(next.widgetMode);
    sync('settings');
  } catch (e) {
    toastError(e);
  }
}
