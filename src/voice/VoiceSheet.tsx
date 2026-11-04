import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { draftFromParsed } from '../core/draft';
import type { HabitDraft, ScheduleKind } from '../core/types';
import { UNITS, unitLabel } from '../core/units';
import { parseVoice, type ParsedHabit, type VoiceIntent } from '../core/voice/parse';
import { broadcast } from '../platform';
import { createHabit, setAmount, setStatus } from '../state/actions';
import { getRepo, toast, useApp } from '../state/store';
import { interpret, Recorder, saveTranscript, transcribe, VoiceError, voiceReady, type Purpose } from '../services/voice';
import { describeSchedule, FREQ_LABEL } from '../ui/format';
import { IconMic } from '../ui/icons';

type Phase =
  | { kind: 'recording' }
  | { kind: 'typing' }
  | { kind: 'working'; label: 'transcribing' | 'understanding' }
  | { kind: 'create'; habit: ParsedHabit; text: string; noteId: string | null }
  | { kind: 'checkin'; intent: Extract<VoiceIntent, { intent: 'checkin' }>; text: string; noteId: string | null }
  | { kind: 'error'; message: string };

interface Props {
  purpose: Purpose;
  /** start with the text field instead of the microphone */
  typing?: boolean;
  onClose: () => void;
  onMoreOptions: (draft: HabitDraft) => void;
}

const FREQS: ScheduleKind[] = ['daily', 'weekdays', 'weekends', 'days_of_week', 'times_per_week', 'every_n_days'];

export function VoiceSheet({ purpose, typing, onClose, onMoreOptions }: Props) {
  const i18n = useApp((s) => s.i18n);
  const habits = useApp((s) => s.habits);
  const weekStart = useApp((s) => s.settings.weekStart);
  const { t } = i18n;
  const [phase, setPhase] = useState<Phase>({ kind: typing ? 'typing' : 'recording' });
  const [level, setLevel] = useState(0);
  const [text, setText] = useState('');
  const rec = useRef<Recorder | null>(null);
  const closed = useRef(false);

  // ---------------------------------------------------------------- recording
  useEffect(() => {
    if (phase.kind !== 'recording') return;
    let cancelled = false;
    (async () => {
      const ready = await voiceReady();
      if (ready !== 'ok') {
        if (cancelled) return;
        setPhase({ kind: 'error', message: t(ready === 'NO_API_KEY' ? 'voiceNoKey' : 'voiceUnsupported') });
        return;
      }
      const r = new Recorder();
      rec.current = r;
      try {
        await r.start(setLevel, () => void finishRecording());
      } catch (e) {
        if (!cancelled) setPhase({ kind: 'error', message: e instanceof VoiceError && e.code === 'NO_MIC' ? t('voiceNoMic') : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind]);

  useEffect(
    () => () => {
      closed.current = true;
      rec.current?.cancel();
    },
    [],
  );

  const finishRecording = async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase({ kind: 'working', label: 'transcribing' });
    const audio = await r.stop();
    if (audio.durationMs < 400 || audio.blob.size < 1000) return onClose();
    try {
      const transcript = await transcribe(audio.blob, audio.mime);
      if (closed.current) return;
      if (!transcript.trim()) return onClose();
      await handleText(transcript, audio);
    } catch (e) {
      const msg =
        e instanceof VoiceError ? (e.code === 'NO_API_KEY' ? t('voiceNoKey') : t('voiceFailed', { msg: e.message })) : String(e);
      setPhase({ kind: 'error', message: msg });
    }
  };

  // ---------------------------------------------------------------- interpretation
  const handleText = async (input: string, audio?: Awaited<ReturnType<Recorder['stop']>>) => {
    setText(input);
    setPhase({ kind: 'working', label: 'understanding' });
    const fromVoice = !!audio;
    // Typed text is interpreted locally (instant); voice may use AI.
    const { intent, provider } = fromVoice
      ? await interpret(input, purpose)
      : { intent: parseVoice(input, ctxNow(purpose)), provider: 'local' as const };
    if (closed.current) return;

    let noteId: string | null = null;
    if (fromVoice) {
      const p = purpose === 'auto' ? (intent.intent === 'note' ? 'inbox' : intent.intent) : purpose === 'inbox' ? 'inbox' : purpose;
      noteId = await saveTranscript({ purpose: p, text: input, intent, provider, audio });
    }

    if (intent.intent === 'create_habit') return setPhase({ kind: 'create', habit: intent.habit, text: input, noteId });
    if (intent.intent === 'checkin') {
      const confident = intent.habitId && intent.confidence >= 0.6;
      if (confident) {
        await applyCheckin(intent, noteId);
        return onClose();
      }
      return setPhase({ kind: 'checkin', intent, text: input, noteId });
    }
    // note
    if (noteId) {
      if (purpose !== 'inbox') await getRepo().setVoiceNoteOutcome(noteId, { inboxState: 'new' });
      void broadcast({ type: 'data', scope: 'inbox' });
      toast(t('savedToInbox'));
    }
    onClose();
  };

  const applyCheckin = async (intent: Extract<VoiceIntent, { intent: 'checkin' }>, noteId: string | null) => {
    const habit = useApp.getState().habits.find((h) => h.id === intent.habitId);
    if (!habit) return;
    let result = null;
    if (intent.value != null && habit.kind === 'count') {
      const existing = useApp.getState().checkins.get(`${habit.id}|${intent.day}`)?.value ?? 0;
      const total = existing + intent.value;
      result = await setAmount(habit, total, intent.markDone || total >= habit.targetValue, 'voice', intent.day);
    } else {
      result = await setStatus(habit, intent.markDone || habit.kind === 'check' ? 'done' : 'partial', intent.day);
    }
    if (noteId) await getRepo().setVoiceNoteOutcome(noteId, { habitId: habit.id, checkinId: result?.id ?? null });
  };

  const saveToInbox = async (noteId: string | null, raw: string) => {
    const id =
      noteId ?? (await saveTranscript({ purpose: 'inbox', text: raw, intent: null, provider: 'typed' }));
    await getRepo().setVoiceNoteOutcome(id, { inboxState: 'new' });
    void broadcast({ type: 'data', scope: 'inbox' });
    toast(t('savedToInbox'));
    onClose();
  };

  // ---------------------------------------------------------------- render
  const sheet = (body: ReactNode) => (
    <div className="voice-sheet" role="dialog" aria-modal onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {body}
    </div>
  );

  if (phase.kind === 'recording' || phase.kind === 'working') {
    const busy = phase.kind === 'working';
    return sheet(
      <>
        <div className={`mic-orb ${busy ? 'busy' : ''}`} style={{ '--lvl': level } as CSSProperties}>
          <IconMic />
        </div>
        <div style={{ textAlign: 'center', fontWeight: 600, marginBottom: 12 }}>
          {busy ? t(phase.label) : t('listening')}
        </div>
        {text && <div className="transcript">{text}</div>}
        {!busy && (
          <div className="sheet-actions" style={{ justifyContent: 'center' }}>
            <button className="btn primary sm" onClick={() => void finishRecording()} autoFocus>
              {t('stopRec')}
            </button>
            <button
              className="btn sm"
              onClick={() => {
                rec.current?.cancel();
                rec.current = null;
                setPhase({ kind: 'typing' });
              }}
            >
              {t('typeInstead')}
            </button>
            <button className="btn ghost sm" onClick={onClose}>
              {t('cancel')}
            </button>
          </div>
        )}
      </>,
    );
  }

  if (phase.kind === 'typing' || phase.kind === 'error') {
    return sheet(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void handleText(text.trim());
        }}
      >
        {phase.kind === 'error' && <div className="transcript" style={{ color: 'var(--red)' }}>{phase.message}</div>}
        <input
          className="input"
          style={{ width: '100%', marginBottom: 10 }}
          autoFocus
          value={text}
          dir="auto"
          placeholder={purpose === 'create_habit' ? t('quickAddPlaceholder') : t('voiceTypePlaceholder')}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="sheet-actions">
          <button type="button" className="btn ghost sm" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary sm" disabled={!text.trim()}>
            {t('send')}
          </button>
        </div>
      </form>,
    );
  }

  if (phase.kind === 'create') {
    return sheet(
      <CreatePreview
        habit={phase.habit}
        transcript={phase.text}
        onCancel={onClose}
        onInbox={() => void saveToInbox(phase.noteId, phase.text)}
        onMore={(d) => {
          onMoreOptions(d);
          onClose();
        }}
        onCreate={async (d) => {
          const id = await createHabit(d);
          if (id && phase.noteId) await getRepo().setVoiceNoteOutcome(phase.noteId, { habitId: id, inboxState: undefined });
          onClose();
        }}
        weekStart={weekStart}
      />,
    );
  }

  // checkin needing confirmation
  const intent = phase.intent;
  return sheet(
    <CheckinConfirm
      intent={intent}
      transcript={phase.text}
      habits={habits.filter((h) => !h.archivedAt)}
      onCancel={onClose}
      onConfirm={async (fixed) => {
        await applyCheckin(fixed, phase.noteId);
        onClose();
      }}
    />,
  );

  function ctxNow(p: Purpose) {
    const s = useApp.getState();
    return { today: s.today, weekStart: s.settings.weekStart, habits: s.habits.filter((h) => !h.archivedAt), purpose: p };
  }
}

// ------------------------------------------------------------------ create preview

function CreatePreview(props: {
  habit: ParsedHabit;
  transcript: string;
  weekStart: number;
  onCreate: (d: HabitDraft) => Promise<void>;
  onMore: (d: HabitDraft) => void;
  onInbox: () => void;
  onCancel: () => void;
}) {
  const i18n = useApp((s) => s.i18n);
  const habitCount = useApp((s) => s.habits.length);
  const { t } = i18n;
  const [d, setD] = useState<HabitDraft>(() => draftFromParsed(props.habit, habitCount));
  const set = (p: Partial<HabitDraft>) => setD((x) => ({ ...x, ...p }));
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!d.title.trim() || busy) return;
        setBusy(true);
        await props.onCreate(d);
      }}
    >
      <div className="sheet-title">{t('createThisHabit')}</div>
      <div className="transcript muted">“{props.transcript}”</div>
      <div className="preview-grid">
        <label>{t('fTitle')}</label>
        <input className="input" dir="auto" value={d.title} onChange={(e) => set({ title: e.target.value })} autoFocus />

        <label>{t('fGoal')}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="input num"
            style={{ width: 70 }}
            inputMode="decimal"
            value={d.kind === 'check' ? '' : String(d.targetValue)}
            placeholder="✓"
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              set(Number.isNaN(v) ? { kind: 'check', targetValue: 1 } : { kind: 'count', targetValue: v, unit: d.unit ?? 'times' });
            }}
          />
          {d.kind === 'count' && (
            <select className="select" value={d.unit ?? ''} onChange={(e) => set({ unit: e.target.value })}>
              {Object.keys(UNITS).map((u) => (
                <option key={u} value={u}>
                  {UNITS[u as keyof typeof UNITS].label}
                </option>
              ))}
              {d.unit && !(d.unit in UNITS) && <option value={d.unit}>{d.unit}</option>}
            </select>
          )}
        </div>

        <label>{t('fFrequency')}</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            className="select"
            value={d.scheduleKind}
            onChange={(e) => {
              const k = e.target.value as ScheduleKind;
              set({
                scheduleKind: k,
                scheduleParams: k === 'days_of_week' ? { days: d.scheduleParams.days ?? [1, 3, 5] } : k === 'times_per_week' || k === 'every_n_days' ? { n: d.scheduleParams.n ?? 3 } : {},
              });
            }}
          >
            {FREQS.map((k) => (
              <option key={k} value={k}>
                {t(FREQ_LABEL[k])}
              </option>
            ))}
          </select>
          {d.scheduleKind === 'days_of_week' && (
            <span className="muted" style={{ fontSize: 12 }}>
              {describeSchedule(d.scheduleKind, d.scheduleParams, i18n, props.weekStart)}
            </span>
          )}
          {(d.scheduleKind === 'times_per_week' || d.scheduleKind === 'every_n_days') && (
            <input
              className="input num"
              style={{ width: 52 }}
              value={String(d.scheduleParams.n ?? 1)}
              onChange={(e) => set({ scheduleParams: { n: Math.max(1, parseInt(e.target.value) || 1) } })}
            />
          )}
        </div>

        <label>{t('fPreferredTime')}</label>
        <input
          className="input num"
          type="time"
          value={d.preferredTime ?? ''}
          onChange={(e) => set({ preferredTime: e.target.value || null, reminderTime: e.target.value || null })}
        />
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn ghost sm" onClick={props.onCancel}>
          {t('cancel')}
        </button>
        <button type="button" className="btn sm" onClick={props.onInbox}>
          {t('saveToInbox')}
        </button>
        <button type="button" className="btn sm" onClick={() => props.onMore(d)}>
          {t('moreOptions')}
        </button>
        <button type="submit" className="btn primary sm" disabled={!d.title.trim() || busy}>
          {t('create')}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ check-in confirm

function CheckinConfirm(props: {
  intent: Extract<VoiceIntent, { intent: 'checkin' }>;
  transcript: string;
  habits: { id: string; title: string; kind: 'check' | 'count'; unit: string | null; targetValue: number }[];
  onConfirm: (i: Extract<VoiceIntent, { intent: 'checkin' }>) => Promise<void>;
  onCancel: () => void;
}) {
  const i18n = useApp((s) => s.i18n);
  const { t } = i18n;
  const ordered = [
    ...props.intent.candidates.map((id) => props.habits.find((h) => h.id === id)!).filter(Boolean),
    ...props.habits.filter((h) => !props.intent.candidates.includes(h.id)),
  ];
  const [habitId, setHabitId] = useState(props.intent.habitId ?? ordered[0]?.id ?? '');
  const [value, setValue] = useState(props.intent.value != null ? String(props.intent.value) : '');
  const [done, setDone] = useState(props.intent.markDone);
  const habit = props.habits.find((h) => h.id === habitId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!habit) return;
        const v = parseFloat(value);
        void props.onConfirm({ ...props.intent, habitId, value: Number.isNaN(v) ? null : v, markDone: done });
      }}
    >
      <div className="sheet-title">{habit ? t('logThis') : t('whichHabit')}</div>
      <div className="transcript muted">“{props.transcript}”</div>
      <div className="preview-grid">
        <label>{t('whichHabit')}</label>
        <select className="select" value={habitId} onChange={(e) => setHabitId(e.target.value)} autoFocus>
          {ordered.map((h) => (
            <option key={h.id} value={h.id}>
              {h.title}
            </option>
          ))}
        </select>
        {habit?.kind === 'count' && (
          <>
            <label>{unitLabel(habit.unit) || t('fGoal')}</label>
            <input className="input num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </>
        )}
        <label>{t('markAsDone')}</label>
        <button type="button" className="toggle" role="switch" aria-checked={done} onClick={() => setDone(!done)} />
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn ghost sm" onClick={props.onCancel}>
          {t('cancel')}
        </button>
        <button type="submit" className="btn primary sm" disabled={!habit}>
          {t('confirm')}
        </button>
      </div>
    </form>
  );
}
