import { useState, type MouseEvent } from 'react';
import { weekday } from '../core/dates';
import type { WidgetMode } from '../data/settings';
import { THEME_LABEL, THEMES } from '../ui/themes';
import { host } from '../platform';
import { updateSettings } from '../state/actions';
import { useToday } from '../state/selectors';
import { useApp } from '../state/store';
import { IconChevron, IconMic, IconMore, IconPlus } from '../ui/icons';
import { Menu, type MenuItem } from '../ui/Menu';
import { Toasts } from '../ui/Toasts';
import { VoiceSheet } from '../voice/VoiceSheet';
import { HabitRow } from './HabitRow';
import { Onboarding } from './Onboarding';
import { closeSheet, editInDashboard, openSheet, useWidgetUi } from './widgetUi';

export function WidgetApp() {
  const settings = useApp((s) => s.settings);
  const i18n = useApp((s) => s.i18n);
  const today = useApp((s) => s.today);
  const habitCount = useApp((s) => s.habits.filter((h) => !h.archivedAt).length);
  const model = useToday();
  const sheet = useWidgetUi((s) => s.sheet);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const { t } = i18n;

  const onHeaderDown = (e: MouseEvent) => {
    if (e.button !== 0 || settings.widgetLocked) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    void host.startDrag();
  };

  const setMode = (widgetMode: WidgetMode) => void updateSettings({ widgetMode });

  const menuItems: MenuItem[] = [
    { label: t('newHabit'), onSelect: () => openSheet('create_habit', true) },
    { label: t('openDashboard'), onSelect: () => void host.openDashboard() },
    { kind: 'sep' },
    { label: t('modeTop'), checked: settings.widgetMode === 'top', onSelect: () => setMode('top') },
    { label: t('modeNormal'), checked: settings.widgetMode === 'normal', onSelect: () => setMode('normal') },
    { label: t('modeDesktop'), checked: settings.widgetMode === 'desktop', onSelect: () => setMode('desktop') },
    { label: t('lockPosition'), checked: settings.widgetLocked, onSelect: () => void updateSettings({ widgetLocked: !settings.widgetLocked }) },
    {
      kind: 'sub',
      label: t('theme'),
      items: THEMES.map((th) => ({ label: t(THEME_LABEL[th]), checked: settings.theme === th, onSelect: () => void updateSettings({ theme: th }) })),
    },
    { label: t('showCompleted'), checked: settings.showCompleted, onSelect: () => void updateSettings({ showCompleted: !settings.showCompleted }) },
    { kind: 'sep' },
    { label: t('hideWidget'), onSelect: () => void host.hideSelf() },
    { label: t('quit'), onSelect: () => void host.quit(), danger: true },
  ];

  const pct = model.total ? model.doneCount / model.total : 0;
  const onboarding = !settings.onboarded;

  return (
    <div className="sticky" data-sticky={settings.theme} onContextMenu={(e) => e.preventDefault()}>
      {onboarding ? (
        <Onboarding />
      ) : (
        <>
          <header className="w-head" onMouseDown={onHeaderDown}>
            <div className="w-head-top">
              <div className="w-title">
                <span className="w-today">{t('todayUpper')}</span>
                <span className="w-date">{`${i18n.weekdayName(weekday(today))}, ${i18n.dayLabel(today, { month: 'short', day: 'numeric' })}`}</span>
              </div>
              <button className="icon-btn" title={t('newHabit')} aria-label={t('newHabit')} onClick={() => openSheet('create_habit', true)}>
                <IconPlus />
              </button>
              <button className="icon-btn" title={`${t('voice')} (Ctrl+Shift+V)`} aria-label={t('voice')} onClick={() => openSheet('auto')}>
                <IconMic />
              </button>
              <button
                className="icon-btn"
                aria-label="Menu"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ x: r.left, y: r.bottom + 4 });
                }}
              >
                <IconMore />
              </button>
            </div>
            {model.total > 0 && (
              <div className="w-progress num">
                <div className="bar">
                  <i style={{ width: `${pct * 100}%` }} />
                </div>
                <span>
                  {i18n.num(model.doneCount)}/{i18n.num(model.total)}
                </span>
                <i className="sep" aria-hidden />
                <span>{i18n.pct(pct)}</span>
              </div>
            )}
          </header>

          <div className="w-body">
            {habitCount === 0 ? (
              <div className="empty">
                <div className="big-emoji">🗒️</div>
                <div style={{ marginBottom: 10 }}>{t('noHabits')}</div>
                <button className="pill" style={{ height: 30, padding: '0 14px' }} onClick={() => openSheet('create_habit', true)}>
                  {t('addFirst')}
                </button>
              </div>
            ) : model.total === 0 && !model.restRows.length ? (
              <div className="empty">{t('nothingToday')}</div>
            ) : (
              <>
                {model.focusRows.length > 0 && (
                  <>
                    <div className="section-label">{t('bigThree')}</div>
                    {model.focusRows.map((r) => (
                      <HabitRow key={r.habit.id} row={r} big onEdit={(id) => void editInDashboard(id)} />
                    ))}
                    {model.openRows.length > 0 && <div className="section-label">{t('others')}</div>}
                  </>
                )}
                {model.openRows.map((r) => (
                  <HabitRow key={r.habit.id} row={r} onEdit={(id) => void editInDashboard(id)} />
                ))}
                {model.openRows.length === 0 && model.focusRows.every((r) => r.tone === 'green') && model.doneCount > 0 && (
                  <div className="empty" style={{ padding: '14px 10px' }}>
                    ✓ {t('allDone')}
                  </div>
                )}
                {settings.showCompleted && model.doneRows.length + model.restRows.length > 0 && (
                  <>
                    <div className="section-label">
                      <button onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
                        <IconChevron open={showDone} width={12} height={12} />
                        {t('completedSection')} · {i18n.num(model.doneRows.length + model.restRows.length)}
                      </button>
                    </div>
                    {showDone &&
                      [...model.doneRows, ...model.restRows].map((r) => (
                        <HabitRow key={r.habit.id} row={r} onEdit={(id) => void editInDashboard(id)} />
                      ))}
                  </>
                )}
              </>
            )}
          </div>

          {sheet && (
            <VoiceSheet
              key={sheet.key}
              purpose={sheet.purpose}
              typing={sheet.typing}
              onClose={closeSheet}
              onMoreOptions={(d) => void editInDashboard(null, d)}
            />
          )}
        </>
      )}

      {!settings.widgetLocked && <div className="grip" onMouseDown={(e) => (e.preventDefault(), void host.startResize())} />}
      {menu && <Menu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      <Toasts />
    </div>
  );
}
