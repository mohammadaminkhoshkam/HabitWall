import { useEffect, useMemo, useState } from 'react';
import { draftFromHabit, emptyDraft, HABIT_COLORS, HABIT_ICONS, validateDraft } from '../core/draft';
import type { HabitDraft, ScheduleKind, TimeOfDay } from '../core/types';
import { defaultSteps, UNITS } from '../core/units';
import { createHabit, saveHabit } from '../state/actions';
import { getRepo, useApp } from '../state/store';
import { FREQ_LABEL } from '../ui/format';
import { IconX } from '../ui/icons';

const DRAFT_KEY = 'hw:editor-draft';
const KINDS: ScheduleKind[] = ['daily', 'weekdays', 'weekends', 'days_of_week', 'times_per_week', 'every_n_days', 'days_of_month'];
const TODS: { k: TimeOfDay; label: 'todMorning' | 'todAfternoon' | 'todEvening' | 'todAny' }[] = [
  { k: 'morning', label: 'todMorning' },
  { k: 'afternoon', label: 'todAfternoon' },
  { k: 'evening', label: 'todEvening' },
  { k: 'any', label: 'todAny' },
];

const num = (s: string) => {
  const v = parseFloat(s);
  return Number.isNaN(v) ? null : v;
};

interface Props {
  habitId: string | null;
  initial?: HabitDraft;
  onClose: () => void;
}

export function HabitEditor({ habitId, initial, onClose }: Props) {
  const i18n = useApp((s) => s.i18n);
  const habits = useApp((s) => s.habits);
  const today = useApp((s) => s.today);
  const weekStart = useApp((s) => s.settings.weekStart);
  const habit = habits.find((h) => h.id === habitId) ?? null;
  const { t } = i18n;

  const [d, setD] = useState<HabitDraft>(() => {
    if (initial) return initial;
    if (habit) return draftFromHabit(habit, today, null);
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore */
    }
    return emptyDraft(today, habits.length);
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = useMemo(() => validateDraft(d), [d]);
  const set = (p: Partial<HabitDraft>) => setD((x) => ({ ...x, ...p }));

  // Existing reminder time for an edited habit
  useEffect(() => {
    if (!habit || initial) return;
    void getRepo()
      .listReminders()
      .then((rs) => {
        const r = rs.find((x) => x.habitId === habit.id && x.kind === 'fixed');
        if (r?.time) setD((x) => ({ ...x, reminderTime: r.time }));
      });
  }, [habit, initial]);

  // Autosave unsaved new-habit drafts.
  useEffect(() => {
    if (habit) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }, [d, habit]);

  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length || busy) return;
    setBusy(true);
    const clean: HabitDraft = {
      ...d,
      quickSteps: d.kind === 'count' ? (d.quickSteps.length ? d.quickSteps : defaultSteps(d.unit, d.targetValue)) : [],
    };
    if (habit) await saveHabit(habit, clean);
    else if (await createHabit(clean)) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
    }
    setBusy(false);
    onClose();
  };

  const err = (k: keyof HabitDraft) => touched && errors[k];
  const days = d.scheduleParams.days ?? [];

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form
        className="drawer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="drawer-head">
          <span style={{ flex: 1 }}>{habit ? t('editorEdit') : t('editorNew')}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <IconX />
          </button>
        </div>

        <div className="drawer-body">
          <div className="field">
            <label htmlFor="f-title">{t('fTitle')}</label>
            <input id="f-title" className={`input ${err('title') ? 'invalid' : ''}`} dir="auto" autoFocus value={d.title} onChange={(e) => set({ title: e.target.value })} />
          </div>

          <div className="field">
            <label>{t('fIcon')}</label>
            <div className="swatches">
              {HABIT_ICONS.map((ic) => (
                <button type="button" key={ic} className="emoji-pick" aria-pressed={d.icon === ic} onClick={() => set({ icon: d.icon === ic ? null : ic })}>
                  {ic}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{t('fColor')}</label>
            <div className="swatches">
              {HABIT_COLORS.map((c) => (
                <button type="button" key={c} className="swatch" aria-label={c} aria-pressed={d.color === c} style={{ background: c }} onClick={() => set({ color: c })} />
              ))}
            </div>
          </div>

          <div className="field">
            <label>{t('fType')}</label>
            <div className="segmented">
              <button type="button" aria-pressed={d.kind === 'check'} onClick={() => set({ kind: 'check', targetValue: 1, unit: null, minValue: null })}>
                {t('typeCheck')}
              </button>
              <button
                type="button"
                aria-pressed={d.kind === 'count'}
                onClick={() => set({ kind: 'count', targetValue: d.kind === 'count' ? d.targetValue : 20, unit: d.unit ?? 'min', quickSteps: d.quickSteps.length ? d.quickSteps : [5, 10] })}
              >
                {t('typeCount')}
              </button>
            </div>
          </div>

          {d.kind === 'count' && (
            <>
              <div className="row2">
                <div className="field">
                  <label>{t('fGoal')}</label>
                  <input className={`input num ${err('targetValue') ? 'invalid' : ''}`} inputMode="decimal" value={String(d.targetValue)} onChange={(e) => set({ targetValue: num(e.target.value) ?? 0 })} />
                </div>
                <div className="field">
                  <label>{t('fUnit')}</label>
                  <select className="select" value={d.unit ?? ''} onChange={(e) => set({ unit: e.target.value, quickSteps: defaultSteps(e.target.value, d.targetValue) })}>
                    {Object.keys(UNITS).map((u) => (
                      <option key={u} value={u}>
                        {UNITS[u as keyof typeof UNITS].label}
                      </option>
                    ))}
                    {d.unit && !(d.unit in UNITS) && <option value={d.unit}>{d.unit}</option>}
                  </select>
                </div>
              </div>
              <div className="row2">
                <div className="field">
                  <label>{t('fMinimum')}</label>
                  <input
                    className={`input num ${err('minValue') ? 'invalid' : ''}`}
                    inputMode="decimal"
                    placeholder={t('none')}
                    value={d.minValue == null ? '' : String(d.minValue)}
                    onChange={(e) => set({ minValue: num(e.target.value) })}
                  />
                  <span className="hint">{t('fMinimumHint')}</span>
                </div>
                <div className="field">
                  <label>{t('fSteps')}</label>
                  <input
                    className="input num"
                    value={d.quickSteps.map((s) => i18n.num(s)).join(', ')}
                    onChange={(e) =>
                      set({
                        quickSteps: e.target.value
                          .split(/[,\s]+/)
                          .map(Number)
                          .filter((n) => n > 0)
                          .slice(0, 3),
                      })
                    }
                  />
                </div>
              </div>
            </>
          )}

          <div className="field">
            <label>{t('fFrequency')}</label>
            <select
              className="select"
              value={d.scheduleKind}
              onChange={(e) => {
                const k = e.target.value as ScheduleKind;
                set({
                  scheduleKind: k,
                  scheduleParams:
                    k === 'days_of_week' ? { days: days.length ? days : [1, 3, 5] } : k === 'times_per_week' || k === 'every_n_days' ? { n: d.scheduleParams.n ?? 3 } : k === 'days_of_month' ? { dates: d.scheduleParams.dates ?? [1] } : {},
                });
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(FREQ_LABEL[k])}
                </option>
              ))}
            </select>
            {d.scheduleKind === 'days_of_week' && (
              <div className="daychips" style={{ marginTop: 4 }}>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (i + weekStart) % 7).map((wd) => (
                  <button
                    type="button"
                    key={wd}
                    className="daychip"
                    aria-pressed={days.includes(wd)}
                    onClick={() => set({ scheduleParams: { days: days.includes(wd) ? days.filter((x) => x !== wd) : [...days, wd].sort() } })}
                  >
                    {i18n.weekdayName(wd, 'short')}
                  </button>
                ))}
              </div>
            )}
            {(d.scheduleKind === 'times_per_week' || d.scheduleKind === 'every_n_days') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  className={`input num ${err('scheduleParams') ? 'invalid' : ''}`}
                  style={{ width: 80 }}
                  value={String(d.scheduleParams.n ?? '')}
                  onChange={(e) => set({ scheduleParams: { n: Math.min(d.scheduleKind === 'times_per_week' ? 7 : 365, Math.max(1, num(e.target.value) ?? 1)) } })}
                />
                <span className="muted">{d.scheduleKind === 'times_per_week' ? t('timesPerWeek') : t('everyNDaysLabel')}</span>
              </div>
            )}
            {d.scheduleKind === 'days_of_month' && (
              <input
                className={`input num ${err('scheduleParams') ? 'invalid' : ''}`}
                style={{ marginTop: 4 }}
                placeholder={t('daysOfMonthHint')}
                defaultValue={(d.scheduleParams.dates ?? []).join(', ')}
                onChange={(e) =>
                  set({
                    scheduleParams: {
                      dates: [...new Set(e.target.value.split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 31))].sort((a, b) => a - b),
                    },
                  })
                }
              />
            )}
          </div>

          <div className="row2">
            <div className="field">
              <label>{t('fPreferredTime')}</label>
              <input className="input num" type="time" value={d.preferredTime ?? ''} onChange={(e) => set({ preferredTime: e.target.value || null })} />
            </div>
            <div className="field">
              <label>{t('fReminder')}</label>
              <input className="input num" type="time" value={d.reminderTime ?? ''} onChange={(e) => set({ reminderTime: e.target.value || null })} />
            </div>
          </div>

          <div className="field">
            <label>{t('fTimeOfDay')}</label>
            <div className="segmented">
              {TODS.map(({ k, label }) => (
                <button type="button" key={k} aria-pressed={d.timeOfDay === k} onClick={() => set({ timeOfDay: k })}>
                  {t(label)}
                </button>
              ))}
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>{t('fStart')}</label>
              <input className="input num" type="date" value={d.startDay} onChange={(e) => e.target.value && set({ startDay: e.target.value })} />
            </div>
            <div className="field">
              <label>{t('fEnd')}</label>
              <input className={`input num ${err('endDay') ? 'invalid' : ''}`} type="date" value={d.endDay ?? ''} onChange={(e) => set({ endDay: e.target.value || null })} />
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>{t('fCategory')}</label>
              <input className="input" dir="auto" value={d.category ?? ''} onChange={(e) => set({ category: e.target.value || null })} />
            </div>
          </div>
          <div className="field">
            <label>{t('fDescription')}</label>
            <textarea className="textarea" dir="auto" value={d.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} />
          </div>
        </div>

        <div className="drawer-foot">
          <button type="submit" className="btn primary" disabled={busy}>
            {t('save')}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          {touched && Object.keys(errors).length > 0 && (
            <span style={{ color: 'var(--red)', fontSize: 12.5, alignSelf: 'center' }}>{t('required')}</span>
          )}
        </div>
      </form>
    </div>
  );
}
