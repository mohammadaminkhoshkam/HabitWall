/*
 * Voice → Transcript → Intent.
 * 1. record (MediaRecorder, auto-stop on silence)   2. transcribe in Rust (key stays in Rust)
 * 3. save the transcript immediately               4. interpret: local parser, then AI if enabled
 */
import { weekday } from '../core/dates';
import { parseVoice, type VoiceIntent } from '../core/voice/parse';
import type { VoiceNote } from '../data/repo';
import { broadcast, isTauri, secrets, voiceApi } from '../platform';
import { getRepo, useApp } from '../state/store';
import { buildInterpretPrompt, fromAiResult } from './ai';

export type Purpose = 'create_habit' | 'checkin' | 'inbox' | 'auto';

export class VoiceError extends Error {
  constructor(readonly code: 'NO_API_KEY' | 'NO_MIC' | 'UNSUPPORTED' | 'FAILED', message?: string) {
    super(message ?? code);
  }
}

// ------------------------------------------------------------------ recorder

const MAX_MS = 30_000;
const SILENCE_MS = 2_200;
const SPEECH_RMS = 0.035;

export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private raf = 0;
  private startedAt = 0;
  private stopResolve: ((r: { blob: Blob; durationMs: number; mime: string }) => void) | null = null;

  async start(onLevel: (level: number) => void, onAutoStop: () => void): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      throw new VoiceError('NO_MIC', String(e));
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => {
      const type = this.rec?.mimeType || 'audio/webm';
      this.stopResolve?.({ blob: new Blob(this.chunks, { type }), durationMs: Date.now() - this.startedAt, mime: type });
      this.cleanup();
    };
    this.rec.start(250);
    this.startedAt = Date.now();

    // Level meter + silence detection
    this.audioCtx = new AudioContext();
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    this.audioCtx.createMediaStreamSource(this.stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let heardSpeech = false;
    let lastLoud = Date.now();
    const loop = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      onLevel(Math.min(1, rms * 8));
      const now = Date.now();
      if (rms > SPEECH_RMS) (heardSpeech = true), (lastLoud = now);
      if ((heardSpeech && now - lastLoud > SILENCE_MS) || now - this.startedAt > MAX_MS) return onAutoStop();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): Promise<{ blob: Blob; durationMs: number; mime: string }> {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === 'inactive') return resolve({ blob: new Blob(), durationMs: 0, mime: 'audio/webm' });
      this.stopResolve = resolve;
      this.rec.stop();
    });
  }

  cancel() {
    this.stopResolve = null;
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    this.cleanup();
  }

  private cleanup() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => {});
    this.stream = null;
    this.audioCtx = null;
  }
}

// ------------------------------------------------------------------ pipeline

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function voiceReady(): Promise<'ok' | 'NO_API_KEY' | 'UNSUPPORTED'> {
  if (!isTauri) return 'UNSUPPORTED';
  return (await secrets.has('openai')) ? 'ok' : 'NO_API_KEY';
}

export async function transcribe(blob: Blob, mime: string): Promise<string> {
  const ready = await voiceReady();
  if (ready !== 'ok') throw new VoiceError(ready);
  const { settings, habits } = useApp.getState();
  try {
    const { text } = await voiceApi.transcribe({
      audioB64: await blobToBase64(blob),
      mime,
      model: settings.voice.transcriptionModel,
      baseUrl: settings.voice.baseUrl || undefined,
      languages: ['en'],
      prompt: 'Short voice note for a personal habit tracker.',
      keywords: habits.filter((h) => !h.archivedAt).map((h) => h.title),
    });
    return text;
  } catch (e) {
    const msg = String(e);
    if (msg.includes('NO_API_KEY')) throw new VoiceError('NO_API_KEY');
    throw new VoiceError('FAILED', msg);
  }
}

/** Local parser always runs (instant, offline); AI refines when configured. */
export async function interpret(text: string, purpose: Purpose): Promise<{ intent: VoiceIntent; provider: 'local' | 'ai' }> {
  const { settings, habits, today, i18n } = useApp.getState();
  const ctx = { today, weekStart: settings.weekStart, habits: habits.filter((h) => !h.archivedAt), purpose };
  const local = parseVoice(text, ctx);
  if (!settings.voice.aiInterpret || (await voiceReady()) !== 'ok') return { intent: local, provider: 'local' };
  try {
    const p = buildInterpretPrompt(text, { ...ctx, weekdayName: i18n.weekdayName(weekday(today)) });
    const raw = await voiceApi.interpret({
      model: settings.voice.interpretModel,
      baseUrl: settings.voice.baseUrl || undefined,
      system: p.system,
      user: p.user,
      schema: p.schema,
    });
    const ai = fromAiResult(raw, text, ctx);
    if (ai && (ai.confidence >= 0.5 || ai.confidence >= local.confidence)) return { intent: ai, provider: 'ai' };
  } catch (e) {
    console.warn('AI interpret failed, using local parser', e);
  }
  return { intent: local, provider: 'local' };
}

/** Persists the transcript right away so nothing is lost if a later step fails. */
export async function saveTranscript(args: {
  purpose: VoiceNote['purpose'];
  text: string;
  intent: VoiceIntent | null;
  provider: string;
  audio?: { blob: Blob; durationMs: number; mime: string } | null;
}): Promise<string> {
  const { settings } = useApp.getState();
  const repo = getRepo();
  const id = await repo.createVoiceNote({
    purpose: args.purpose,
    durationMs: args.audio?.durationMs ?? null,
    audioPath: null,
    text: args.text,
    language: 'en',
    provider: args.provider,
    interpretation: args.intent,
  });
  void broadcast({ type: 'data', scope: 'inbox' }).catch(() => {});
  if (args.audio && settings.voice.keepAudio && isTauri) {
    try {
      const ext = args.audio.mime.includes('ogg') ? 'ogg' : 'webm';
      const path = await voiceApi.saveAudio(id, await blobToBase64(args.audio.blob), ext);
      await repo.db.execute('UPDATE voice_notes SET audio_path = ? WHERE id = ?', [path, id]);
    } catch (e) {
      console.warn('could not keep audio', e);
    }
  }
  return id;
}
