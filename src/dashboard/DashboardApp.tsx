import { useEffect, useState, type ComponentType } from 'react';
import type { HabitDraft } from '../core/types';
import { onBus } from '../platform';
import { useApp } from '../state/store';
import { IconCalendar, IconChart, IconCheck, IconInbox, IconList, IconReview, IconSearch, IconSettings, IconToday } from '../ui/icons';
import { Toasts } from '../ui/Toasts';
import { takePendingEdit } from '../widget/widgetUi';
import { CalendarScreen } from './CalendarScreen';
import { HabitEditor } from './HabitEditor';
import { HabitsScreen } from './HabitsScreen';
import { InboxScreen, useInboxCount } from './InboxScreen';
import { ReviewScreen } from './ReviewScreen';
import { SearchPalette } from './SearchPalette';
import { SettingsScreen } from './SettingsScreen';
import { StatsScreen } from './StatsScreen';
import { TodayScreen } from './TodayScreen';

export type Route = 'today' | 'habits' | 'calendar' | 'stats' | 'inbox' | 'review' | 'settings';

export interface ScreenProps {
  go: (r: Route, arg?: string) => void;
  edit: (id: string | null, draft?: HabitDraft) => void;
  arg?: string;
}

const NAV: { r: Route; label: 'navToday' | 'navHabits' | 'navCalendar' | 'navStats' | 'navInbox' | 'navReview' | 'navSettings'; Icon: ComponentType }[] = [
  { r: 'today', label: 'navToday', Icon: IconToday },
  { r: 'habits', label: 'navHabits', Icon: IconList },
  { r: 'calendar', label: 'navCalendar', Icon: IconCalendar },
  { r: 'stats', label: 'navStats', Icon: IconChart },
  { r: 'inbox', label: 'navInbox', Icon: IconInbox },
  { r: 'review', label: 'navReview', Icon: IconReview },
  { r: 'settings', label: 'navSettings', Icon: IconSettings },
];

const SCREENS: Record<Route, ComponentType<ScreenProps>> = {
  today: TodayScreen,
  habits: HabitsScreen,
  calendar: CalendarScreen,
  stats: StatsScreen,
  inbox: InboxScreen,
  review: ReviewScreen,
  settings: SettingsScreen,
};

export default function DashboardApp() {
  const i18n = useApp((s) => s.i18n);
  const { t } = i18n;
  const [route, setRoute] = useState<{ r: Route; arg?: string }>(() => {
    const h = location.hash.replace(/^#dashboard\/?/, '') as Route;
    return { r: SCREENS[h] ? h : 'today' };
  });
  const [editor, setEditor] = useState<{ id: string | null; draft?: HabitDraft; key: number } | null>(null);
  const [search, setSearch] = useState(false);
  const inboxCount = useInboxCount();

  const go = (r: Route, arg?: string) => setRoute({ r, arg });
  const edit = (id: string | null, draft?: HabitDraft) => setEditor({ id, draft, key: Date.now() });

  useEffect(() => {
    const pending = takePendingEdit();
    if (pending) {
      go('habits');
      edit(pending.id, pending.draft);
    }
    let off: (() => void) | undefined;
    void onBus((evt) => {
      if (evt.type === 'nav' && SCREENS[evt.route as Route]) go(evt.route as Route);
      if (evt.type === 'edit-habit') {
        takePendingEdit();
        go('habits');
        edit(evt.id, evt.draft as HabitDraft | undefined);
      }
    }).then((u) => (off = u));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        edit(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off?.();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const Screen = SCREENS[route.r];
  return (
    <div className="dash">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <span className="brand-mark">
            <IconCheck />
          </span>
          <span>HabitWall</span>
        </div>
        <button className="search-btn" onClick={() => setSearch(true)}>
          <IconSearch />
          <span>{t('search')}</span>
          <kbd>Ctrl K</kbd>
        </button>
        {NAV.map(({ r, label, Icon }) => (
          <button key={r} className="nav-item" aria-current={route.r === r ? 'page' : undefined} onClick={() => go(r)}>
            <Icon />
            <span>{t(label)}</span>
            {r === 'inbox' && inboxCount > 0 && <span className="count num">{i18n.num(inboxCount)}</span>}
          </button>
        ))}
        <div className="side-foot">🔒 {t('sPrivacy')}</div>
      </nav>
      <main className="main">
        <Screen key={route.r} go={go} edit={edit} arg={route.arg} />
      </main>
      {editor && <HabitEditor key={editor.key} habitId={editor.id} initial={editor.draft} onClose={() => setEditor(null)} />}
      {search && <SearchPalette onClose={() => setSearch(false)} go={go} edit={edit} />}
      <Toasts />
    </div>
  );
}
