import { useEffect, useMemo, useState } from 'react';
import { addDays, startOfWeek } from '../core/dates';
import { findInsights, type Insight, type ProgressEventLite } from '../core/insights';
import { weeklyReview } from '../core/review';
import { useCalendarCtx } from '../state/selectors';
import { getRepo, useApp } from '../state/store';
import { IconArrow } from '../ui/icons';
import { Ring } from './TodayScreen';

export function ReviewScreen() {
  const i18n = useApp((s) => s.i18n);
  const allHabits = useApp((s) => s.habits);
  const checkins = useApp((s) => s.checkins);
  const today = useApp((s) => s.today);
  const ctx = useCalendarCtx();
  const { t } = i18n;
  const habits = useMemo(() => allHabits.filter((h) => !h.archivedAt), [allHabits]);
  const thisWeek = startOfWeek(today, ctx.weekStart);
  const [week, setWeek] = useState(thisWeek);
  const [events, setEvents] = useState<ProgressEventLite[]>([]);

  useEffect(() => {
    void getRepo()
      .listEvents(addDays(today, -60))
      .then(setEvents)
      .catch(console.warn);
  }, [today, checkins]);

  const review = useMemo(() => weeklyReview(habits, week, checkins, ctx, today), [habits, week, checkins, ctx, today]);
  const insights = useMemo(() => findInsights(habits, checkins, events, ctx, today), [habits, checkins, events, ctx, today]);
  const name = (id: string | null) => habits.find((h) => h.id === id)?.title ?? '—';
  const byId = new Map(habits.map((h) => [h.id, h]));

  const insightText = (ins: Insight) => {
    const habit = name(ins.habitId);
    switch (ins.kind) {
      case 'time_of_day':
        return t('insightTime', { habit, pct: ins.liftPct, time: i18n.time(`${String(ins.beforeHour).padStart(2, '0')}:00`) });
      case 'weekday_miss':
        return t('insightWeekday', { habit, day: i18n.weekdayName(ins.weekday) });
      case 'most_consistent':
        return t('insightConsistent', { habit });
    }
  };

  const trend = review.trend;
  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>{t('reviewTitle')}</h1>
          <div className="sub">
            {t('weekOf', { d: i18n.dayLabel(week, { day: 'numeric', month: 'long' }) })} — {i18n.dayLabel(review.weekEnd, { day: 'numeric', month: 'long' })}
          </div>
        </div>
        <button className="icon-btn" aria-label={t('prevWeek')} onClick={() => setWeek(addDays(week, -7))}>
          <IconArrow dir="prev" />
        </button>
        <button className="icon-btn" aria-label={t('nextWeek')} disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>
          <IconArrow dir="next" />
        </button>
      </div>

      <div className="card" style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        <Ring value={review.overall ?? 0} size={64} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 750 }} className="num">
            {i18n.pct(review.overall)}
          </div>
          {trend != null && (
            <div className={`num ${trend >= 0 ? 'trend-up' : 'trend-down'}`} style={{ fontSize: 13, fontWeight: 600 }}>
              {trend >= 0 ? '▲' : '▼'} {i18n.pct(Math.abs(trend))} {t('trend')}
            </div>
          )}
        </div>
        <div className="metrics" style={{ flex: 2 }}>
          <div className="metric">
            <div className="k">{t('bestHabit')}</div>
            <div style={{ fontWeight: 650 }}>{name(review.bestHabitId)}</div>
          </div>
          <div className="metric">
            <div className="k">{t('needsAttention')}</div>
            <div style={{ fontWeight: 650 }}>{name(review.needsAttentionId)}</div>
          </div>
          <div className="metric">
            <div className="k">{t('mostProductive')}</div>
            <div style={{ fontWeight: 650 }}>{review.mostProductiveWeekday != null ? i18n.weekdayName(review.mostProductiveWeekday) : '—'}</div>
          </div>
        </div>
      </div>

      <div className="card">
        {review.rows.length === 0 && <div className="muted">{t('noData')}</div>}
        {review.rows.map((r) => (
          <div key={r.habitId} className="hbar">
            <span className="name">
              {byId.get(r.habitId)?.icon} {r.title}
            </span>
            <span className="track">
              <i style={{ width: `${(r.ratio ?? 0) * 100}%`, background: byId.get(r.habitId)?.color ?? 'var(--green)' }} />
            </span>
            <span className="num muted">
              {i18n.num(r.done)} / {i18n.num(r.due)} · {i18n.pct(r.ratio)}
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>{t('insights')}</h2>
        {insights.length ? (
          insights.map((ins, i) => (
            <div key={i} className="insight">
              <span>💡</span>
              <span>{insightText(ins)}</span>
            </div>
          ))
        ) : (
          <div className="muted">{t('noInsights')}</div>
        )}
      </div>
    </div>
  );
}
