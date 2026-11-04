import { useMemo, useState } from 'react';
import { scheduleFor } from '../core/schedule';
import { computeHabitStats } from '../core/stats';
import type { Habit } from '../core/types';
import { archiveHabit, deleteHabit, reorderHabits } from '../state/actions';
import { useCalendarCtx } from '../state/selectors';
import { useApp } from '../state/store';
import { describeSchedule } from '../ui/format';
import { IconChevron, IconPlus } from '../ui/icons';
import type { ScreenProps } from './DashboardApp';

export function HabitsScreen({ edit }: ScreenProps) {
  const i18n = useApp((s) => s.i18n);
  const habits = useApp((s) => s.habits);
  const checkins = useApp((s) => s.checkins);
  const today = useApp((s) => s.today);
  const weekStart = useApp((s) => s.settings.weekStart);
  const ctx = useCalendarCtx();
  const { t } = i18n;
  const [confirm, setConfirm] = useState<Habit | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = habits.filter((h) => !h.archivedAt);
  const archived = habits.filter((h) => h.archivedAt);
  const stats = useMemo(() => new Map(habits.map((h) => [h.id, computeHabitStats(h, checkins, ctx, today)])), [habits, checkins, ctx, today]);

  const move = (i: number, dir: -1 | 1) => {
    const ids = active.map((h) => h.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorderHabits(ids);
  };

  const item = (h: Habit, i: number, isArchived = false) => {
    const s = stats.get(h.id)!;
    const sched = scheduleFor(h, today);
    const goal = h.kind === 'count' ? i18n.amount(h.targetValue, h.unit) : '✓';
    return (
      <div key={h.id} className="hitem" onClick={() => edit(h.id)} style={isArchived ? { opacity: 0.65 } : undefined}>
        <div className="hicon" style={{ background: `color-mix(in srgb, ${h.color} 16%, transparent)` }}>
          {h.icon ?? <span style={{ width: 10, height: 10, borderRadius: 5, background: h.color }} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="htitle">{h.title}</div>
          <div className="hmeta num">
            {goal} · {describeSchedule(sched.kind, sched.params, i18n, weekStart)}
            {h.preferredTime ? ` · ${i18n.time(h.preferredTime)}` : ''}
          </div>
        </div>
        <div className="hstats num">
          <div>
            <b>{i18n.plural(s.streakUnit === 'week' ? 'streakWeeks' : 'streakDays', s.currentStreak)}</b>
            {t('currentStreak')}
          </div>
          <div>
            <b>{i18n.pct(s.consistency30)}</b>
            {t('consistency30')}
          </div>
        </div>
        <div className="hactions" onClick={(e) => e.stopPropagation()}>
          {!isArchived && (
            <>
              <button className="icon-btn" aria-label="Up" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button className="icon-btn" aria-label="Down" onClick={() => move(i, 1)} disabled={i === active.length - 1}>
                ↓
              </button>
            </>
          )}
          <button className="btn sm ghost" onClick={() => void archiveHabit(h, !isArchived)}>
            {isArchived ? t('unarchive') : t('archive')}
          </button>
          <button className="btn sm ghost" style={{ color: 'var(--red)' }} onClick={() => setConfirm(h)}>
            {t('delete')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('habitsTitle')}</h1>
        <button className="btn primary" onClick={() => edit(null)}>
          <IconPlus width={15} height={15} />
          {t('newHabit')}
        </button>
      </div>

      <div className="card">
        {active.length ? <div className="hlist">{active.map((h, i) => item(h, i))}</div> : <div className="empty muted">{t('emptyHabits')}</div>}
      </div>

      {archived.length > 0 && (
        <div className="card">
          <button className="btn ghost sm" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>
            <IconChevron open={showArchived} width={12} height={12} />
            {t('archived')} · {i18n.num(archived.length)}
          </button>
          {showArchived && <div className="hlist" style={{ marginTop: 8 }}>{archived.map((h, i) => item(h, i, true))}</div>}
        </div>
      )}

      {confirm && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="dialog" role="alertdialog" aria-modal>
            <div style={{ fontWeight: 650, fontSize: 15, marginBottom: 8 }}>{t('delete')}</div>
            <div className="muted" style={{ marginBottom: 18 }}>
              {t('deleteConfirm', { title: confirm.title })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirm(null)} autoFocus>
                {t('cancel')}
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  void deleteHabit(confirm);
                  setConfirm(null);
                }}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
