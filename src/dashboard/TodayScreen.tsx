import { weekday } from '../core/dates';
import { useToday } from '../state/selectors';
import { useApp } from '../state/store';
import { IconPlus } from '../ui/icons';
import { HabitRow } from '../widget/HabitRow';
import type { ScreenProps } from './DashboardApp';

export function TodayScreen({ edit }: ScreenProps) {
  const i18n = useApp((s) => s.i18n);
  const today = useApp((s) => s.today);
  const model = useToday();
  const { t } = i18n;
  const pct = model.total ? model.doneCount / model.total : 0;
  const all = [...model.focusRows, ...model.openRows];
  const finished = [...model.doneRows, ...model.restRows];

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>{i18n.weekdayName(weekday(today))}</h1>
          <div className="sub">{i18n.dayLabel(today, { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <button className="btn primary" onClick={() => edit(null)}>
          <IconPlus width={15} height={15} />
          {t('newHabit')}
        </button>
      </div>

      {model.total > 0 && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <Ring value={pct} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }} className="num">
              {t('progress', { done: model.doneCount, total: model.total })}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {pct >= 1 ? t('allDone') : i18n.pct(pct)}
            </div>
          </div>
        </div>
      )}

      <div className="card rows-surface">
        {model.focusRows.length > 0 && <h2>{t('bigThree')}</h2>}
        {model.focusRows.map((r) => (
          <HabitRow key={r.habit.id} row={r} big onEdit={(id) => edit(id)} />
        ))}
        {model.focusRows.length > 0 && model.openRows.length > 0 && <h2 style={{ marginTop: 14 }}>{t('others')}</h2>}
        {model.openRows.map((r) => (
          <HabitRow key={r.habit.id} row={r} onEdit={(id) => edit(id)} />
        ))}
        {!all.length && <div className="empty muted">{model.total ? t('allDone') : t('nothingToday')}</div>}
      </div>

      {finished.length > 0 && (
        <div className="card rows-surface">
          <h2>{t('completedSection')}</h2>
          {finished.map((r) => (
            <HabitRow key={r.habit.id} row={r} onEdit={(id) => edit(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Ring({ value, size = 54, color = 'var(--green)' }: { value: number; size?: number; color?: string }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', flex: 'none' }} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={7} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, value))}
        style={{ transition: 'stroke-dashoffset .5s var(--ease)' }}
      />
    </svg>
  );
}
