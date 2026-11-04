import { useMemo, useState } from 'react';
import { weekday } from '../core/dates';
import { isDue } from '../core/schedule';
import { daySummary, strengthOf } from '../core/stats';
import { displayStatus, statusTone } from '../core/status';
import { checkinKey, type Day } from '../core/types';
import { dayOfMonth, monthDays, monthTitle, shiftMonth } from '../i18n/calendar';
import { setStatus, tapHabit } from '../state/actions';
import { useCalendarCtx } from '../state/selectors';
import { useApp } from '../state/store';
import { IconArrow, IconCheck, IconDash } from '../ui/icons';
import type { ScreenProps } from './DashboardApp';

export function CalendarScreen({ arg }: ScreenProps) {
  const i18n = useApp((s) => s.i18n);
  const habits = useApp((s) => s.habits);
  const checkins = useApp((s) => s.checkins);
  const today = useApp((s) => s.today);
  const weekStart = useApp((s) => s.settings.weekStart);
  const ctx = useCalendarCtx();
  const { t } = i18n;
  const [anchor, setAnchor] = useState<Day>(arg ?? today);
  const [selected, setSelected] = useState<Day>(arg ?? today);

  const days = useMemo(() => monthDays(anchor), [anchor]);
  const lead = (weekday(days[0]) - weekStart + 7) % 7;
  const summaries = useMemo(() => new Map(days.map((d) => [d, daySummary(habits, d, checkins, ctx)])), [days, habits, checkins, ctx]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{monthTitle(anchor)}</h1>
        <button className="icon-btn" aria-label="prev" onClick={() => setAnchor(shiftMonth(anchor, -1))}>
          <IconArrow dir="prev" />
        </button>
        <button className="btn sm" onClick={() => (setAnchor(today), setSelected(today))}>
          {t('today')}
        </button>
        <button className="icon-btn" aria-label="next" onClick={() => setAnchor(shiftMonth(anchor, 1))}>
          <IconArrow dir="next" />
        </button>
      </div>

      <div className="cal-layout">
        <div className="card">
          <div className="cal-grid">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="cal-wd">
                {i18n.weekdayName((i + weekStart) % 7, 'short')}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`b${i}`} />
            ))}
            {days.map((d) => {
              const s = summaries.get(d)!;
              const future = d > today;
              const strength = future ? 'none' : strengthOf(s.ratio);
              return (
                <button
                  key={d}
                  className={`cal-cell ${strength} ${d === today ? 'today' : ''} ${future ? 'future' : ''}`}
                  aria-pressed={d === selected}
                  onClick={() => setSelected(d)}
                >
                  <span className="d num">{i18n.num(dayOfMonth(d))}</span>
                  {!future && s.ratio != null && <span className="p num">{i18n.pct(s.ratio)}</span>}
                </button>
              );
            })}
          </div>
          <div className="legend" style={{ marginTop: 14 }}>
            <span>
              <i style={{ background: 'color-mix(in srgb, var(--green) 26%, var(--panel))' }} />
              {t('strong')} ≥ {i18n.pct(1)}
            </span>
            <span>
              <i style={{ background: 'color-mix(in srgb, var(--green) 12%, var(--panel))' }} />
              {t('good')} ≥ {i18n.pct(0.6)}
            </span>
            <span>
              <i style={{ background: 'color-mix(in srgb, #f5a524 14%, var(--panel))' }} />
              {t('weak')}
            </span>
          </div>
        </div>

        <div className="card">
          <h2>{i18n.dayLabel(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          {habits.filter((h) => isDue(h, selected, ctx)).length === 0 && <div className="muted">{t('nothingToday')}</div>}
          {habits
            .filter((h) => isDue(h, selected, ctx))
            .map((h) => {
              const c = checkins.get(checkinKey(h.id, selected));
              const st = displayStatus(h, selected, checkins, ctx, { today });
              const tone = statusTone(st);
              const future = selected > today;
              return (
                <div key={h.id} className="rows-surface" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                  <div className={`row tone-${tone}`} style={{ padding: '4px 0', cursor: 'default' }}>
                    <button className="check" disabled={future} onClick={() => void tapHabit(h, selected)} aria-label={t('markDone')}>
                      {tone === 'green' ? <IconCheck /> : tone === 'gray' ? <IconDash /> : null}
                    </button>
                    <div className="row-main">
                      <div className="row-title">
                        {h.icon && <span className="icon">{h.icon}</span>}
                        <span className="t">{h.title}</span>
                      </div>
                      <div className="row-sub num">
                        {h.kind === 'count' && c ? `${i18n.num(c.value)} / ${i18n.amount(c.targetSnapshot, h.unit)}` : ''}
                        {st === 'skipped' && t('skippedLabel')}
                        {st === 'rest' && t('restLabel')}
                      </div>
                    </div>
                    {!future && tone !== 'green' && tone !== 'gray' && (
                      <button className="pill" onClick={() => void setStatus(h, 'rest', selected)}>
                        {t('markRest')}
                      </button>
                    )}
                  </div>
                  {c?.note && (
                    <div className="muted" style={{ fontSize: 12.5, fontStyle: 'italic', paddingInlineStart: 32 }}>
                      {t('note')}: “{c.note}”
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
