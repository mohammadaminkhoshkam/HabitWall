import { useState } from 'react';
import { draftFromParsed, emptyDraft } from '../core/draft';
import type { HabitDraft, ScheduleKind } from '../core/types';
import { UNITS } from '../core/units';
import { parseVoice } from '../core/voice/parse';
import { createDemo } from '../data/demo';
import { broadcast } from '../platform';
import { createHabit, updateSettings } from '../state/actions';
import { getRepo, reloadAll, toastError, useApp } from '../state/store';
import { THEME_LABEL, THEMES } from '../ui/themes';

const SUGGESTIONS = ['20 min English', '30 min exercise', '10 pages of a book', '8 glasses of water', '10 min meditation'];

const SWATCH: Record<string, string> = {
  red: 'linear-gradient(160deg,#ffe6e2,#ffd2cb)',
  blue: 'linear-gradient(160deg,#e3edff,#cfdfff)',
  dark: 'linear-gradient(160deg,#2b2b30,#1b1b1e)',
  light: 'linear-gradient(160deg,#fffef8,#f2efe2)',
  minimal: '#ffffff',
  glass: 'linear-gradient(160deg,rgba(255,255,255,.8),rgba(220,228,240,.6))',
};

export function Onboarding() {
  const i18n = useApp((s) => s.i18n);
  const settings = useApp((s) => s.settings);
  const today = useApp((s) => s.today);
  const { t } = i18n;
  const [step, setStep] = useState(0);
  const [what, setWhat] = useState('');
  const [d, setD] = useState<HabitDraft>(() => emptyDraft(today));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<HabitDraft>) => setD((x) => ({ ...x, ...p }));

  const fromText = (text: string) => {
    setWhat(text);
    if (!text.trim()) return;
    const r = parseVoice(text, { today, weekStart: settings.weekStart, habits: [], purpose: 'create_habit' });
    if (r.intent === 'create_habit') setD(draftFromParsed(r.habit));
  };

  const finish = async () => {
    setBusy(true);
    const ok = await createHabit({ ...d, title: d.title.trim() || what.trim() }, true);
    if (ok) await updateSettings({ onboarded: true });
    setBusy(false);
  };

  const demo = async () => {
    setBusy(true);
    try {
      await createDemo(getRepo(), today, { weekendDays: settings.weekendDays, weekStart: settings.weekStart });
      await reloadAll();
      await broadcast({ type: 'data', scope: 'all' });
      await updateSettings({ onboarded: true });
    } catch (e) {
      toastError(e);
    }
    setBusy(false);
  };

  const freq = (k: ScheduleKind, params = {}) => set({ scheduleKind: k, scheduleParams: params });

  return (
    <div className="w-body" style={{ padding: '18px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ height: 4, flex: 1, borderRadius: 4, background: i <= step ? 'var(--s-ink)' : 'var(--s-line)', transition: 'background .2s' }} />
          ))}
        </div>
      </div>

      {step === 0 && (
        <>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{t('obWhatTitle')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--s-ink-2)' }}>{t('obWhatHint')}</div>
          </div>
          <form
            className="quick-add"
            style={{ margin: 0 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (what.trim()) setStep(1);
            }}
          >
            <input autoFocus dir="auto" value={what} placeholder={t('obWhatPlaceholder')} onChange={(e) => fromText(e.target.value)} />
          </form>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="pill" onClick={() => fromText(s)}>
                {s}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn primary" disabled={!what.trim()} onClick={() => setStep(1)}>
            {t('obNext')}
          </button>
          <button className="btn ghost sm" disabled={busy} onClick={() => void demo()} style={{ color: 'var(--s-ink-2)' }}>
            {t('obDemo')}
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{t('obWhenTitle')}</div>
          <input className="input" dir="auto" value={d.title || what} onChange={(e) => set({ title: e.target.value })} style={{ background: 'var(--chip-bg)', borderColor: 'var(--s-line)', color: 'var(--s-ink)' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(
              [
                ['daily', 'freqDaily', {}],
                ['weekdays', 'freqWeekdays', {}],
                ['days_of_week', 'freqDays', { days: d.scheduleParams.days ?? [1, 3, 5] }],
                ['times_per_week', 'freqTimesPerWeek', { n: d.scheduleParams.n ?? 3 }],
              ] as const
            ).map(([k, label, params]) => (
              <button
                key={k}
                className="pill"
                style={d.scheduleKind === k ? { background: 'var(--s-ink)', color: 'var(--paper)' } : undefined}
                onClick={() => freq(k, params)}
              >
                {t(label)}
              </button>
            ))}
          </div>
          {d.scheduleKind === 'days_of_week' && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (i + settings.weekStart) % 7).map((wd) => {
                const on = d.scheduleParams.days?.includes(wd);
                return (
                  <button
                    key={wd}
                    className="pill"
                    style={on ? { background: 'var(--s-ink)', color: 'var(--paper)' } : undefined}
                    onClick={() => {
                      const days = new Set(d.scheduleParams.days ?? []);
                      on ? days.delete(wd) : days.add(wd);
                      set({ scheduleParams: { days: [...days].sort() } });
                    }}
                  >
                    {i18n.weekdayName(wd, 'short')}
                  </button>
                );
              })}
            </div>
          )}
          {d.scheduleKind === 'times_per_week' && (
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} className="pill num" style={d.scheduleParams.n === n ? { background: 'var(--s-ink)', color: 'var(--paper)' } : undefined} onClick={() => set({ scheduleParams: { n } })}>
                  {i18n.num(n)}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 10px', alignItems: 'center', fontSize: 12.5 }}>
            <span style={{ color: 'var(--s-ink-2)' }}>{t('fGoal')}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input num"
                style={{ width: 64, background: 'var(--chip-bg)', borderColor: 'var(--s-line)', color: 'var(--s-ink)' }}
                inputMode="decimal"
                placeholder="✓"
                value={d.kind === 'count' ? String(d.targetValue) : ''}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  set(Number.isNaN(v) ? { kind: 'check', targetValue: 1 } : { kind: 'count', targetValue: v, unit: d.unit ?? 'min', quickSteps: d.quickSteps.length ? d.quickSteps : [5, 10] });
                }}
              />
              {d.kind === 'count' && (
                <select className="select" value={d.unit ?? 'min'} onChange={(e) => set({ unit: e.target.value })} style={{ background: 'var(--chip-bg)', borderColor: 'var(--s-line)', color: 'var(--s-ink)' }}>
                  {Object.keys(UNITS).map((u) => (
                    <option key={u} value={u}>
                      {UNITS[u as keyof typeof UNITS].label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <span style={{ color: 'var(--s-ink-2)' }}>{t('fReminder')}</span>
            <input
              className="input num"
              type="time"
              value={d.preferredTime ?? ''}
              onChange={(e) => set({ preferredTime: e.target.value || null, reminderTime: e.target.value || null })}
              style={{ width: 120, background: 'var(--chip-bg)', borderColor: 'var(--s-line)', color: 'var(--s-ink)' }}
            />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={() => setStep(0)}>
              {t('obBack')}
            </button>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => setStep(2)} disabled={d.scheduleKind === 'days_of_week' && !d.scheduleParams.days?.length}>
              {t('obNext')}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{t('obStyleTitle')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {THEMES.map((th) => (
              <button
                key={th}
                onClick={() => void updateSettings({ theme: th })}
                style={{
                  height: 64,
                  borderRadius: 10,
                  border: settings.theme === th ? '2px solid var(--blue)' : '1px solid var(--s-line)',
                  background: SWATCH[th],
                  color: th === 'dark' ? '#eee' : '#222',
                  fontSize: 11.5,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'flex-end',
                  padding: 6,
                  boxShadow: '0 1px 3px rgba(0,0,0,.08)',
                }}
              >
                {t(THEME_LABEL[th])}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={() => setStep(1)}>
              {t('obBack')}
            </button>
            <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={() => void finish()}>
              {t('obStart')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
