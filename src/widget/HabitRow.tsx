import { memo, useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { unitLabel } from '../core/units';
import {
  addAmount,
  doMinimum,
  resetHabit,
  setAmount,
  setNote,
  setStatus,
  snoozeHabit,
  startTimer,
  stopTimer,
  tapHabit,
  toggleFocus,
} from '../state/actions';
import type { TodayRow } from '../state/selectors';
import { useApp } from '../state/store';
import { IconCheck, IconDash, IconPause, IconPlay } from '../ui/icons';
import { Menu, type MenuItem } from '../ui/Menu';

interface Props {
  row: TodayRow;
  big?: boolean;
  onEdit: (habitId: string) => void;
}

const dismissedRecovery = new Set<string>();

/** A thin rule between items. */
export function joinSep(parts: (ReactNode | false | null | undefined | '')[]): ReactNode[] {
  const out: ReactNode[] = [];
  parts.filter(Boolean).forEach((p, i) => {
    if (i) out.push(<i key={`sep${i}`} className="sep" aria-hidden />);
    out.push(p);
  });
  return out;
}

function useElapsed(since: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return null;
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const HabitRow = memo(function HabitRow({ row, big, onEdit }: Props) {
  const { habit, checkin, status, tone, ratio, stats, weekly } = row;
  const i18n = useApp((s) => s.i18n);
  const celebrate = useApp((s) => s.celebrate === habit.id);
  const focusCount = useApp((s) => s.focus.length);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<'amount' | 'note' | null>(null);
  const [draft, setDraft] = useState('');
  const [, force] = useState(0);
  const elapsed = useElapsed(checkin?.activeSince ?? null);
  const { t, amount, num } = i18n;

  const isCount = habit.kind === 'count';
  const value = checkin?.value ?? 0;
  const unit = habit.unit;
  const timerCapable = isCount && unit === 'min';
  const isFinal = tone === 'green' || tone === 'gray';

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const startEdit = (kind: 'amount' | 'note') => {
    setDraft(kind === 'note' ? checkin?.note ?? '' : value ? String(value) : '');
    setEditing(kind);
  };

  const commitEdit = () => {
    if (editing === 'amount') {
      const v = parseFloat(draft);
      if (!Number.isNaN(v)) void setAmount(habit, v, v >= habit.targetValue);
    } else if (editing === 'note') {
      void setNote(habit, draft);
    }
    setEditing(null);
  };

  const items: MenuItem[] = [
    { label: t('markDone'), onSelect: () => void setStatus(habit, 'done') },
    { label: t('markPartial'), onSelect: () => void setStatus(habit, 'partial') },
    { label: t('markSkip'), onSelect: () => void setStatus(habit, 'skipped') },
    { label: t('markRest'), onSelect: () => void setStatus(habit, 'rest') },
    { kind: 'sep' },
    ...(isCount ? [{ label: t('customAmount'), onSelect: () => startEdit('amount') }] : []),
    ...(timerCapable
      ? [{ label: checkin?.activeSince ? t('stopTimer') : t('startTimer'), onSelect: () => void (checkin?.activeSince ? stopTimer(habit) : startTimer(habit)) }]
      : []),
    { label: checkin?.note ? t('editNote') : t('addNote'), onSelect: () => startEdit('note') },
    {
      kind: 'sub',
      label: t('snooze'),
      items: [
        { label: t('snooze10'), onSelect: () => void snoozeHabit(habit, 10) },
        { label: t('snooze30'), onSelect: () => void snoozeHabit(habit, 30) },
        { label: t('snooze60'), onSelect: () => void snoozeHabit(habit, 60) },
        { label: t('snoozeTonight'), onSelect: () => void snoozeHabit(habit, 'tonight') },
      ],
    },
    ...(row.focus || focusCount < 3
      ? [{ label: row.focus ? t('removeFocus') : t('addFocus'), onSelect: () => void toggleFocus(habit.id) }]
      : []),
    { kind: 'sep' },
    { label: t('edit'), onSelect: () => onEdit(habit.id) },
    ...(checkin ? [{ label: t('reset'), onSelect: () => void resetHabit(habit) }] : []),
  ];

  // ---- secondary line
  let sub: string;
  if (status === 'done') sub = isCount && value > habit.targetValue ? `✓ ${amount(value, unit)}` : `✓ ${t('completed')}`;
  else if (status === 'week_done') sub = `✓ ${t('weekDone')}`;
  else if (status === 'skipped') sub = t('skippedLabel');
  else if (status === 'rest') sub = t('restLabel');
  else if (weekly) sub = t('weekProgress', { n: weekly.done, q: weekly.quota });
  else if (isCount) sub = value > 0 ? `${num(value)} / ${amount(habit.targetValue, unit)}` : amount(habit.targetValue, unit);
  else sub = '';
  const timeHint = habit.preferredTime && !isFinal ? i18n.time(habit.preferredTime) : null;

  const showRecovery =
    !isFinal && stats.missedRun > 0 && value === 0 && !dismissedRecovery.has(`${habit.id}`) && !weekly;

  const steps = isCount ? habit.quickSteps.slice(0, 2) : [];
  const stepLabel = (s: number) => `+${num(s)}`;

  return (
    <>
      <div
        className={`row tone-${tone} ${big ? 'big' : ''} ${celebrate ? 'celebrate' : ''}`}
        style={{ '--p': ratio } as CSSProperties}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, input, textarea')) return;
          void tapHabit(habit);
        }}
        onContextMenu={openMenu}
        role="group"
        aria-label={habit.title}
      >
        <button
          className="check"
          aria-label={status === 'done' ? t('reset') : t('markDone')}
          onClick={() => void tapHabit(habit)}
        >
          {tone === 'green' ? <IconCheck /> : tone === 'gray' ? <IconDash /> : null}
        </button>

        <div className="row-main">
          <div className="row-title">
            {habit.icon ? <span className="icon">{habit.icon}</span> : <span className="habit-dot" style={{ background: habit.color }} />}
            <span className="t">{habit.title}</span>
          </div>
          {(sub || timeHint || status === 'overdue' || elapsed) && (
            <div className="row-sub num">
              {joinSep([
                sub && <span key="s">{sub}</span>,
                timeHint && <span key="t">{timeHint}</span>,
                status === 'overdue' && (
                  <span key="o" className="overdue">
                    {t('overdue')}
                  </span>
                ),
                elapsed && (
                  <span key="e" style={{ color: 'var(--blue)', fontWeight: 600 }}>
                    ⏱ {elapsed}
                  </span>
                ),
                big && stats.currentStreak >= 2 && !isFinal && (
                  <span key="k" style={{ opacity: 0.75 }}>
                    {i18n.plural(stats.streakUnit === 'week' ? 'streakWeeks' : 'streakDays', stats.currentStreak)}
                  </span>
                ),
              ])}
            </div>
          )}
          {isCount && !weekly && !isFinal && value > 0 && (
            <div className="mini-bar">
              <i style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
          )}
        </div>

        <div className={`qa ${checkin?.activeSince ? 'show' : ''}`}>
          {!isFinal && timerCapable && (
            <button
              className={`pill ${checkin?.activeSince ? 'timer-on' : ''}`}
              title={checkin?.activeSince ? t('stopTimer') : t('startTimer')}
              onClick={() => void (checkin?.activeSince ? stopTimer(habit) : startTimer(habit))}
            >
              {checkin?.activeSince ? <IconPause /> : <IconPlay />}
            </button>
          )}
          {!isFinal &&
            steps.map((s) => (
              <button key={s} className="pill num" title={amount(s, unit)} onClick={() => void addAmount(habit, s)}>
                {stepLabel(s)}
              </button>
            ))}
          {!isFinal && big && !isCount && (
            <button className="pill" onClick={() => void setStatus(habit, 'skipped')}>
              {t('skip')}
            </button>
          )}
        </div>

        {showRecovery && (
          <div className="recovery">
            <span>{t('recoveryTitle', { n: i18n.plural('recoveryDays', stats.missedRun) })}</span>
            <button
              className="pill"
              onClick={() => {
                dismissedRecovery.add(habit.id);
                if (!row.focus && focusCount < 3) void toggleFocus(habit.id);
                force((n) => n + 1);
              }}
            >
              {t('resumeToday')}
            </button>
            {habit.minValue != null && isCount && (
              <button className="pill" onClick={() => void doMinimum(habit)}>
                {t('doMinimum', { v: amount(habit.minValue, unit) })}
              </button>
            )}
          </div>
        )}

        {checkin?.note && !editing && <div className="note-line">“{checkin.note}”</div>}

        {editing && (
          <div className="inline-edit" onClick={(e) => e.stopPropagation()}>
            {editing === 'amount' ? (
              <input
                className="input num"
                autoFocus
                inputMode="decimal"
                value={draft}
                placeholder={unitLabel(unit)}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => (e.key === 'Enter' ? commitEdit() : e.key === 'Escape' && setEditing(null))}
                onBlur={commitEdit}
              />
            ) : (
              <textarea
                className="textarea"
                autoFocus
                value={draft}
                placeholder={t('note')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => (e.key === 'Enter' && !e.shiftKey ? (e.preventDefault(), commitEdit()) : e.key === 'Escape' && setEditing(null))}
                onBlur={commitEdit}
              />
            )}
          </div>
        )}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
});
