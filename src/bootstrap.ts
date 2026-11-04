import { addDays, startOfWeek, weekday } from './core/dates';
import { buildCheckinMap } from './core/stats';
import { weeklyReview } from './core/review';
import { migrate } from './data/migrations';
import { Repo } from './data/repo';
import { defaultSettings, mergeSettings, type Settings } from './data/settings';
import { makeI18n } from './i18n';
import { broadcast, createDb, host, onBus, onTray, registerShortcuts, type WindowKind } from './platform';
import { startDayClock } from './services/dayClock';
import { startReminders } from './services/reminders';
import { getRepo, loadCheckins, loadFocus, loadHabits, reloadAll, useApp } from './state/store';
import { logicalDay } from './core/dates';

function applyDocument(s: Settings, kind: WindowKind) {
  const root = document.documentElement;
  root.lang = 'en';
  root.dir = 'ltr';
  if (s.colorScheme === 'system') delete root.dataset.theme;
  else root.dataset.theme = s.colorScheme;
  document.body.classList.toggle('is-widget', kind === 'widget');
  document.title = 'HabitWall';
}

async function loadSettings(): Promise<Settings> {
  const stored = await getRepo().loadSettings();
  return mergeSettings(defaultSettings(), stored);
}

/** On the first day of a new week, keep a snapshot of last week's review. */
async function snapshotLastWeek() {
  const s = useApp.getState();
  const ws = startOfWeek(s.today, s.settings.weekStart);
  if (weekday(s.today) !== s.settings.weekStart) return;
  const prev = addDays(ws, -7);
  const list = await getRepo().listCheckins(addDays(prev, -7), addDays(prev, 6));
  const review = weeklyReview(s.habits, prev, buildCheckinMap(list), s.settings, s.today);
  await getRepo().saveReview(prev, review);
}

export async function bootstrap(kind: WindowKind) {
  const db = await createDb();
  await migrate(db);
  const repo = new Repo(db);
  useApp.setState({ repo, windowKind: kind });

  const settings = await loadSettings();
  applyDocument(settings, kind);
  useApp.setState({
    settings,
    i18n: makeI18n(),
    today: logicalDay(new Date(), settings.dayStartMinutes),
  });
  await reloadAll();
  useApp.setState({ ready: true });

  startDayClock(() => {
    if (kind === 'widget') void snapshotLastWeek().catch(console.warn);
  });

  // Keep the other window in sync.
  await onBus(async (evt) => {
    if (evt.type !== 'data') return;
    if (evt.scope === 'settings' || evt.scope === 'all') {
      const next = await loadSettings();
      useApp.setState({ settings: next });
    }
    if (evt.scope === 'habits' || evt.scope === 'all') await loadHabits();
    if (evt.scope === 'checkins' || evt.scope === 'all') await loadCheckins();
    if (evt.scope === 'focus' || evt.scope === 'all') await loadFocus();
  });

  // React to settings changes in this window.
  useApp.subscribe((s, p) => {
    if (s.settings !== p.settings) applyDocument(s.settings, kind);
  });

  if (kind === 'widget') await setupWidget();
}

async function setupWidget() {
  const { openSheet } = await import('./widget/widgetUi');
  startReminders();

  let unregister: (() => void) | null = null;
  const bindShortcuts = async () => {
    unregister?.();
    const { shortcuts } = useApp.getState().settings;
    unregister = await registerShortcuts({
      [shortcuts.toggle]: () => void host.toggleSelf(),
      [shortcuts.voice]: () => {
        void host.showSelf();
        openSheet('auto');
      },
      [shortcuts.newHabit]: () => {
        void host.showSelf();
        openSheet('create_habit', true);
      },
    });
  };
  await bindShortcuts();

  await onTray((action) => (action === 'voice' ? openSheet('auto') : openSheet('create_habit', true)));

  const trayLabels = () => {
    const { t } = useApp.getState().i18n;
    void host.setTrayLabels({
      toggle: t('scToggle'),
      dashboard: t('openDashboard'),
      voice: t('scVoice'),
      newHabit: t('newHabit'),
      quit: t('quit'),
    });
  };

  const s = useApp.getState().settings;
  await host.setWidgetMode(s.widgetMode);
  await host.setGlass(s.theme === 'glass');
  trayLabels();

  useApp.subscribe((st, p) => {
    if (st.settings.shortcuts !== p.settings.shortcuts) void bindShortcuts();
    if (st.settings.theme !== p.settings.theme) void host.setGlass(st.settings.theme === 'glass');
    if (st.settings.widgetMode !== p.settings.widgetMode) void host.setWidgetMode(st.settings.widgetMode);
  });

  await host.showSelf();
  void broadcast({ type: 'data', scope: 'all' }).catch(() => {});
}
