import { useEffect, useState, type ReactNode } from 'react';
import { hhmm } from '../core/dates';
import { createDemo } from '../data/demo';
import type { Settings } from '../data/settings';
import { acceleratorFromEvent, broadcast, isTauri, secrets } from '../platform';
import { updateSettings } from '../state/actions';
import { getRepo, reloadAll, toast, toastError, useApp } from '../state/store';
import { THEME_LABEL, THEMES } from '../ui/themes';

function Row({ k, h, children }: { k: string; h?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <div className="k">{k}</div>
        {h && <div className="h">{h}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button className="toggle" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} />;
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useApp((s) => s.i18n.t);
  const [rec, setRec] = useState(false);
  return (
    <button
      className={`kbd-rec ${rec ? 'rec' : ''}`}
      onClick={() => setRec(true)}
      onBlur={() => setRec(false)}
      onKeyDown={(e) => {
        if (!rec) return;
        e.preventDefault();
        if (e.key === 'Escape') return setRec(false);
        const acc = acceleratorFromEvent(e.nativeEvent);
        if (acc) {
          onChange(acc);
          setRec(false);
        }
      }}
    >
      {rec ? t('scRecord') : value.replace('CommandOrControl', 'Ctrl')}
    </button>
  );
}

export function SettingsScreen() {
  const i18n = useApp((s) => s.i18n);
  const s = useApp((st) => st.settings);
  const habitCount = useApp((st) => st.habits.length);
  const today = useApp((st) => st.today);
  const { t } = i18n;
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const up = (p: Partial<Settings>) => void updateSettings(p);

  useEffect(() => {
    void secrets.has('openai').then(setHasKey);
  }, []);

  const weekOrder = [0, 1, 2, 3, 4, 5, 6].map((i) => (i + s.weekStart) % 7);

  const exportJson = async () => {
    try {
      const data = await getRepo().exportAll();
      const blob = new Blob([JSON.stringify({ app: 'HabitWall', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], {
        type: 'application/json',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `habitwall-${today}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('settingsTitle')}</h1>
      </div>

      <div className="card">
        <h2>{t('sGeneral')}</h2>
        <Row k={t('sDayStart')} h={t('sDayStartHint')}>
          <select className="select num" value={s.dayStartMinutes} onChange={(e) => up({ dayStartMinutes: Number(e.target.value) })}>
            {[0, 60, 120, 180, 240, 300, 360].map((m) => (
              <option key={m} value={m}>
                {i18n.time(hhmm(m))}
              </option>
            ))}
          </select>
        </Row>
        <Row k={t('sWeekStart')}>
          <select className="select" value={s.weekStart} onChange={(e) => up({ weekStart: Number(e.target.value) })}>
            {[6, 0, 1].map((d) => (
              <option key={d} value={d}>
                {i18n.weekdayName(d)}
              </option>
            ))}
          </select>
        </Row>
        <Row k={t('sWeekend')}>
          <div className="daychips">
            {weekOrder.map((d) => (
              <button
                key={d}
                className="daychip"
                aria-pressed={s.weekendDays.includes(d)}
                onClick={() => up({ weekendDays: s.weekendDays.includes(d) ? s.weekendDays.filter((x) => x !== d) : [...s.weekendDays, d] })}
              >
                {i18n.weekdayName(d, 'short')}
              </button>
            ))}
          </div>
        </Row>
        <Row k={t('sAutostart')} h={isTauri ? undefined : t('desktopOnly')}>
          <Toggle on={s.autostart} disabled={!isTauri} onChange={(v) => up({ autostart: v })} />
        </Row>
      </div>

      <div className="card">
        <h2>{t('sAppearance')}</h2>
        <Row k={t('theme')}>
          <div className="segmented">
            {THEMES.map((th) => (
              <button key={th} aria-pressed={s.theme === th} onClick={() => up({ theme: th })}>
                {t(THEME_LABEL[th])}
              </button>
            ))}
          </div>
        </Row>
        <Row k={t('modeTop')}>
          <div className="segmented">
            <button aria-pressed={s.widgetMode === 'top'} onClick={() => up({ widgetMode: 'top' })}>
              {t('modeTop')}
            </button>
            <button aria-pressed={s.widgetMode === 'normal'} onClick={() => up({ widgetMode: 'normal' })}>
              {t('modeNormal')}
            </button>
            <button aria-pressed={s.widgetMode === 'desktop'} onClick={() => up({ widgetMode: 'desktop' })}>
              {t('modeDesktop')}
            </button>
          </div>
        </Row>
        <Row k={t('sColorScheme')}>
          <div className="segmented">
            {(['system', 'light', 'dark'] as const).map((c) => (
              <button key={c} aria-pressed={s.colorScheme === c} onClick={() => up({ colorScheme: c })}>
                {t(c === 'system' ? 'schemeSystem' : c === 'light' ? 'schemeLight' : 'schemeDark')}
              </button>
            ))}
          </div>
        </Row>
      </div>

      <div className="card">
        <h2>{t('sNotifications')}</h2>
        <Row k={t('sNotifEnabled')}>
          <Toggle on={s.notifications.enabled} onChange={(v) => up({ notifications: { ...s.notifications, enabled: v } })} />
        </Row>
        <Row k={t('sEndOfDay')}>
          <input
            className="input num"
            type="time"
            value={s.notifications.endOfDay ?? ''}
            onChange={(e) => up({ notifications: { ...s.notifications, endOfDay: e.target.value || null } })}
          />
        </Row>
        <Row k={t('sStartupNudge')}>
          <Toggle on={s.notifications.startupNudge} onChange={(v) => up({ notifications: { ...s.notifications, startupNudge: v } })} />
        </Row>
        <Row k={t('sMaxPerHour')}>
          <select className="select num" value={s.notifications.maxPerHour} onChange={(e) => up({ notifications: { ...s.notifications, maxPerHour: Number(e.target.value) } })}>
            {[1, 2, 3, 4, 6, 10].map((n) => (
              <option key={n} value={n}>
                {i18n.num(n)}
              </option>
            ))}
          </select>
        </Row>
      </div>

      <div className="card">
        <h2>{t('sShortcuts')}</h2>
        <Row k={t('scToggle')}>
          <ShortcutRecorder value={s.shortcuts.toggle} onChange={(v) => up({ shortcuts: { ...s.shortcuts, toggle: v } })} />
        </Row>
        <Row k={t('scVoice')}>
          <ShortcutRecorder value={s.shortcuts.voice} onChange={(v) => up({ shortcuts: { ...s.shortcuts, voice: v } })} />
        </Row>
        <Row k={t('scNew')}>
          <ShortcutRecorder value={s.shortcuts.newHabit} onChange={(v) => up({ shortcuts: { ...s.shortcuts, newHabit: v } })} />
        </Row>
      </div>

      <div className="card">
        <h2>{t('sVoice')}</h2>
        <Row k={t('sApiKey')} h={isTauri ? (hasKey ? `✓ ${t('sApiKeySet')}` : t('sApiKeyMissing')) : t('desktopOnly')}>
          {isTauri && (
            <form
              style={{ display: 'flex', gap: 6 }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!key.trim()) return;
                try {
                  await secrets.set('openai', key.trim());
                  setKey('');
                  setHasKey(true);
                  toast(t('toastSaved'));
                } catch (err) {
                  toastError(err);
                }
              }}
            >
              <input className="input" type="password" autoComplete="off" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 200, direction: 'ltr' }} />
              <button className="btn" type="submit" disabled={!key.trim()}>
                {t('sApiKeySave')}
              </button>
              {hasKey && (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={async () => {
                    await secrets.remove('openai');
                    setHasKey(false);
                  }}
                >
                  {t('sApiKeyRemove')}
                </button>
              )}
            </form>
          )}
        </Row>
        <Row k={t('sTranscriptionModel')}>
          <input className="input" style={{ direction: 'ltr', width: 200 }} value={s.voice.transcriptionModel} onChange={(e) => up({ voice: { ...s.voice, transcriptionModel: e.target.value } })} />
        </Row>
        <Row k={t('sBaseUrl')}>
          <input
            className="input"
            style={{ direction: 'ltr', width: 260 }}
            placeholder="https://api.openai.com/v1"
            value={s.voice.baseUrl}
            onChange={(e) => up({ voice: { ...s.voice, baseUrl: e.target.value } })}
          />
        </Row>
        <Row k={t('sAiInterpret')} h={t('sAiInterpretHint')}>
          <Toggle on={s.voice.aiInterpret} onChange={(v) => up({ voice: { ...s.voice, aiInterpret: v } })} />
        </Row>
        {s.voice.aiInterpret && (
          <Row k={t('sInterpretModel')}>
            <input className="input" style={{ direction: 'ltr', width: 200 }} value={s.voice.interpretModel} onChange={(e) => up({ voice: { ...s.voice, interpretModel: e.target.value } })} />
          </Row>
        )}
        <Row k={t('sKeepAudio')}>
          <Toggle on={s.voice.keepAudio} onChange={(v) => up({ voice: { ...s.voice, keepAudio: v } })} />
        </Row>
      </div>

      <div className="card">
        <h2>{t('sData')}</h2>
        <Row k={t('sPrivacy')}>
          <button className="btn" onClick={() => void exportJson()}>
            {t('sExport')}
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                await createDemo(getRepo(), today, { weekendDays: s.weekendDays, weekStart: s.weekStart }, habitCount === 0);
                await reloadAll();
                void broadcast({ type: 'data', scope: 'all' });
              } catch (e) {
                toastError(e);
              }
            }}
          >
            {t('sDemo')}
          </button>
        </Row>
      </div>
    </div>
  );
}
