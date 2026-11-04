import { create } from 'zustand';
import { addDays, logicalDay, minutesIntoDay } from '../core/dates';
import { buildCheckinMap } from '../core/stats';
import type { CheckinMap, Day, Habit } from '../core/types';
import type { Repo } from '../data/repo';
import { defaultSettings, type Settings } from '../data/settings';
import { makeI18n, type I18n } from '../i18n';
import type { WindowKind } from '../platform';

export interface Toast {
  id: number;
  text: string;
  undo?: () => Promise<void>;
  tone?: 'info' | 'error';
}

/** How far back check-ins are kept in memory (1-year heatmap + a margin). */
export const HISTORY_DAYS = 400;

export interface AppState {
  ready: boolean;
  windowKind: WindowKind;
  repo: Repo | null;
  settings: Settings;
  i18n: I18n;
  habits: Habit[];
  checkins: CheckinMap;
  focus: string[];
  today: Day;
  /** minutes into the logical day; ticks every 30 s for overdue states and timers */
  minuteOfDay: number;
  toasts: Toast[];
  /** habit id to animate as just-completed */
  celebrate: string | null;
}

const initialSettings = defaultSettings();

export const useApp = create<AppState>(() => ({
  ready: false,
  windowKind: 'widget',
  repo: null,
  settings: initialSettings,
  i18n: makeI18n(),
  habits: [],
  checkins: new Map(),
  focus: [],
  today: logicalDay(new Date(), initialSettings.dayStartMinutes),
  minuteOfDay: minutesIntoDay(new Date(), initialSettings.dayStartMinutes),
  toasts: [],
  celebrate: null,
}));

export const getRepo = (): Repo => {
  const r = useApp.getState().repo;
  if (!r) throw new Error('repo not ready');
  return r;
};

// ------------------------------------------------------------------ loaders

export async function loadHabits() {
  useApp.setState({ habits: await getRepo().listHabits() });
}

export async function loadCheckins() {
  const { today } = useApp.getState();
  const list = await getRepo().listCheckins(addDays(today, -HISTORY_DAYS), addDays(today, 1));
  useApp.setState({ checkins: buildCheckinMap(list) });
}

export async function loadFocus() {
  const { today } = useApp.getState();
  useApp.setState({ focus: await getRepo().getFocus(today) });
}

export async function reloadAll() {
  await Promise.all([loadHabits(), loadCheckins(), loadFocus()]);
}

// ------------------------------------------------------------------ toasts

let toastSeq = 0;

export function toast(text: string, undo?: () => Promise<void>, tone: Toast['tone'] = 'info') {
  const id = ++toastSeq;
  useApp.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, undo, tone }] }));
  setTimeout(() => dismissToast(id), undo ? 6000 : 3000);
  return id;
}

export function dismissToast(id: number) {
  useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function toastError(e: unknown) {
  const { i18n } = useApp.getState();
  const msg = e instanceof Error ? e.message : String(e);
  console.error(e);
  toast(i18n.t('error', { msg }), undefined, 'error');
}

/** Selector helper: active (non-archived) habits in order. */
export const activeHabits = (s: AppState) => s.habits.filter((h) => !h.archivedAt);
