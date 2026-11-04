import { useMemo, useState, type CSSProperties } from 'react';
import { addDays, startOfWeek } from '../core/dates';
import { computeHabitStats, heatCell, type HeatCell } from '../core/stats';
import type { Day, Habit } from '../core/types';
import { dayOfMonth } from '../i18n/calendar';
import { useCalendarCtx } from '../state/selectors';
import { useApp } from '../state/store';

const RANGES = [
  { days: 7, label: 'range7' },
  { days: 30, label: 'range30' },
  { days: 90, label: 'range90' },
  { days: 365, label: 'range365' },
] as const;

export function StatsScreen() {
  const i18n = useApp((s) => s.i18n);
  const allHabits = useApp((s) => s.habits);
  const habits = useMemo(() => allHabits.filter((h) => !h.archivedAt), [allHabits]);
  const checkins = useApp((s) => s.checkins);
  const today = useApp((s) => s.today);
  const ctx = useCalendarCtx();
  const { t } = i18n;
  const [habitId, setHabitId] = useState<string | null>(habits[0]?.id ?? null);
  const [range, setRange] = useState<7 | 30 | 90 | 365>(90);
  const habit = habits.find((h) => h.id === habitId) ?? habits[0];

  const all = useMemo(() => habits.map((h) => ({ h, s: computeHabitStats(h, checkins, ctx, today) })), [habits, checkins, ctx, today]);

  if (!habit) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>{t('statsTitle')}</h1>
        </div>
        <div className="card muted">{t('emptyHabits')}</div>
      </div>
    );
  }
  const s = all.find((x) => x.h.id === habit.id)!.s;
  const streak = (n: number) => i18n.plural(s.streakUnit === 'week' ? 'streakWeeks' : 'streakDays', n);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('statsTitle')}</h1>
      </div>

      <div className="card">
        <h2>{t('consistency30')}</h2>
        {all.map(({ h, s: hs }) => (
          <button
            key={h.id}
            className="hbar"
            style={{ width: '100%', border: 0, background: 'none', textAlign: 'start', cursor: 'pointer', borderRadius: 8, fontWeight: h.id === habit.id ? 650 : 400 }}
            onClick={() => setHabitId(h.id)}
          >
            <span className="name">
              {h.icon} {h.title}
            </span>
            <span className="track">
              <i style={{ width: `${(hs.consistency30 ?? 0) * 100}%`, background: h.color }} />
            </span>
            <span className="num muted">{i18n.pct(hs.consistency30)}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 22 }}>{habit.icon}</span>
          <span style={{ fontWeight: 700, fontSize: 17, flex: 1 }}>{habit.title}</span>
          <select className="select" value={habit.id} onChange={(e) => setHabitId(e.target.value)}>
            {habits.map((h) => (
              <option key={h.id} value={h.id}>
                {h.title}
              </option>
            ))}
          </select>
        </div>
        <div className="metrics num">
          <Metric k={t('currentStreak')} v={streak(s.currentStreak)} />
          <Metric k={t('bestStreak')} v={streak(s.bestStreak)} />
          <Metric k={t('consistency30')} v={i18n.pct(s.consistency30)} />
          <Metric k={t('completion7')} v={i18n.pct(s.completion7)} />
          <Metric k={t('completion30')} v={i18n.pct(s.completion30)} />
          <Metric k={t('totalCompletions')} v={i18n.num(s.totalCompletions)} />
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, flex: 1 }}>{t('heatmap')}</h2>
          <div className="segmented">
            {RANGES.map((r) => (
              <button key={r.days} aria-pressed={range === r.days} onClick={() => setRange(r.days)}>
                {t(r.label)}
              </button>
            ))}
          </div>
        </div>
        <Heatmap habit={habit} days={range} today={today} />
      </div>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="metric">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

const cls = (c: HeatCell) => (c.kind === 'level' ? `l${c.level}` : c.kind);

export function Heatmap({ habit, days, today }: { habit: Habit; days: number; today: Day }) {
  const checkins = useApp((s) => s.checkins);
  const i18n = useApp((s) => s.i18n);
  const weekStart = useApp((s) => s.settings.weekStart);
  const ctx = useCalendarCtx();
  const wide = days <= 30;
  const first = wide ? addDays(today, -(days - 1)) : startOfWeek(addDays(today, -(days - 1)), weekStart);
  const cells: Day[] = [];
  for (let d = first; d <= (wide ? today : addDays(startOfWeek(today, weekStart), 6)); d = addDays(d, 1)) cells.push(d);

  return (
    <div className={`heat ${wide ? 'wide' : ''}`} style={{ '--hc': habit.color } as CSSProperties} role="img" aria-label="heatmap">
      {cells.map((d) => {
        const c = heatCell(habit, d, checkins, ctx, today);
        return (
          <div key={d} className={`hc ${cls(c)}`} title={`${i18n.dayLabel(d, { day: 'numeric', month: 'short', weekday: 'short' })}`}>
            {wide && (
              <span style={{ fontSize: 10, opacity: 0.6, padding: 3, display: 'block' }} className="num">
                {i18n.num(dayOfMonth(d))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
