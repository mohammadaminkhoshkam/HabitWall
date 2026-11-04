import { useCallback, useEffect, useState } from 'react';
import { draftFromParsed } from '../core/draft';
import { parseVoice } from '../core/voice/parse';
import type { InboxState, VoiceNote } from '../data/repo';
import { broadcast, onBus } from '../platform';
import { getRepo, toast, toastError, useApp } from '../state/store';
import { describeSchedule } from '../ui/format';
import type { ScreenProps } from './DashboardApp';

function useInbox() {
  const [items, setItems] = useState<VoiceNote[]>([]);
  const reload = useCallback(async () => {
    try {
      setItems(await getRepo().listInbox());
    } catch (e) {
      console.warn(e);
    }
  }, []);
  useEffect(() => {
    void reload();
    let off: (() => void) | undefined;
    void onBus((e) => e.type === 'data' && (e.scope === 'inbox' || e.scope === 'all') && void reload()).then((u) => (off = u));
    return () => off?.();
  }, [reload]);
  return { items, reload };
}

export function useInboxCount() {
  const { items } = useInbox();
  return items.filter((i) => i.inboxState === 'new').length;
}

export function InboxScreen({ edit }: ScreenProps) {
  const i18n = useApp((s) => s.i18n);
  const today = useApp((s) => s.today);
  const weekStart = useApp((s) => s.settings.weekStart);
  const habits = useApp((s) => s.habits);
  const { t } = i18n;
  const { items, reload } = useInbox();

  const setState = async (n: VoiceNote, state: InboxState, message?: string) => {
    try {
      const prev = n.inboxState ?? 'new';
      await getRepo().setVoiceNoteOutcome(n.id, { inboxState: state });
      await reload();
      void broadcast({ type: 'data', scope: 'inbox' });
      if (message) {
        toast(message, async () => {
          await getRepo().setVoiceNoteOutcome(n.id, { inboxState: prev });
          await reload();
          void broadcast({ type: 'data', scope: 'inbox' });
        });
      }
    } catch (e) {
      toastError(e);
    }
  };

  const group = (state: InboxState) => items.filter((i) => i.inboxState === state);
  const fresh = group('new');
  const tasks = group('task');
  const notes = group('note');

  const render = (n: VoiceNote) => {
    const parsed = n.text ? parseVoice(n.text, { today, weekStart, habits, purpose: 'inbox' }) : null;
    const suggestion =
      parsed?.intent === 'create_habit'
        ? `${t('toHabit')}: ${parsed.habit.title} · ${describeSchedule(parsed.habit.scheduleKind, parsed.habit.scheduleParams, i18n, weekStart)}`
        : null;
    const when = new Date(n.createdAt);
    return (
      <div key={n.id} className="inbox-item">
        <div style={{ minWidth: 0 }}>
          <div className="inbox-text" dir="auto">
            {n.text}
          </div>
          <div className="inbox-meta num">
            <span>
              {i18n.dayLabel(n.createdAt.slice(0, 10), { day: 'numeric', month: 'short' })} ·{' '}
              {i18n.time(`${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`)}
            </span>
            {n.audioPath && <span>🎧</span>}
            {suggestion && n.inboxState === 'new' && <span className="chip">💡 {suggestion}</span>}
          </div>
        </div>
        <div className="inbox-actions">
          {n.inboxState === 'new' && (
            <>
              <button
                className="btn sm primary"
                onClick={() => {
                  if (parsed?.intent === 'create_habit') edit(null, draftFromParsed(parsed.habit, habits.length));
                  else edit(null, { ...draftFromParsed({ ...emptyParsed(today), title: n.text ?? '' }, habits.length) });
                  void setState(n, 'habit');
                }}
              >
                {t('toHabit')}
              </button>
              <button className="btn sm" onClick={() => void setState(n, 'task')}>
                {t('toTask')}
              </button>
              <button className="btn sm" onClick={() => void setState(n, 'note')}>
                {t('keepNote')}
              </button>
            </>
          )}
          {n.inboxState === 'task' && (
            <button className="btn sm" onClick={() => void setState(n, 'deleted', t('done'))}>
              ✓ {t('done')}
            </button>
          )}
          <button className="btn sm ghost" style={{ color: 'var(--red)' }} onClick={() => void setState(n, 'deleted', t('delete'))}>
            {t('delete')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('inboxTitle')}</h1>
      </div>
      <div className="card">{fresh.length ? fresh.map(render) : <div className="muted">🎙️ {t('inboxEmpty')}</div>}</div>
      {tasks.length > 0 && (
        <div className="card">
          <h2>{t('task')}</h2>
          {tasks.map(render)}
        </div>
      )}
      {notes.length > 0 && (
        <div className="card">
          <h2>{t('noteLabel')}</h2>
          {notes.map(render)}
        </div>
      )}
    </div>
  );
}

function emptyParsed(today: string) {
  return {
    title: '',
    icon: null,
    kind: 'check' as const,
    targetValue: 1,
    unit: null,
    minValue: null,
    quickSteps: [],
    scheduleKind: 'daily' as const,
    scheduleParams: {},
    preferredTime: null,
    timeOfDay: 'any' as const,
    startDay: today,
  };
}
