export type ThemeId = 'red' | 'blue' | 'dark' | 'light' | 'minimal' | 'glass';
export type WidgetMode = 'top' | 'normal' | 'desktop';

export interface Settings {
  onboarded: boolean;
  /** Minutes after midnight when the user's day starts (e.g. 240 = 04:00). */
  dayStartMinutes: number;
  /** 0 = Sunday … 6 = Saturday */
  weekStart: number;
  weekendDays: number[];
  theme: ThemeId;
  colorScheme: 'system' | 'light' | 'dark';
  widgetMode: WidgetMode;
  widgetLocked: boolean;
  showCompleted: boolean;
  autostart: boolean;
  shortcuts: { toggle: string; voice: string; newHabit: string };
  notifications: {
    enabled: boolean;
    /** 'HH:MM' nudge for anything still open; null = off */
    endOfDay: string | null;
    startupNudge: boolean;
    startupDelayMin: number;
    maxPerHour: number;
  };
  voice: {
    transcriptionModel: string;
    baseUrl: string;
    aiInterpret: boolean;
    interpretModel: string;
    keepAudio: boolean;
  };
}

export function defaultSettings(): Settings {
  return {
    onboarded: false,
    dayStartMinutes: 240,
    weekStart: 1,
    weekendDays: [0, 6],
    theme: 'red',
    colorScheme: 'system',
    widgetMode: 'top',
    widgetLocked: false,
    showCompleted: true,
    autostart: false,
    shortcuts: {
      toggle: 'CommandOrControl+Shift+H',
      voice: 'CommandOrControl+Shift+V',
      newHabit: 'CommandOrControl+Shift+N',
    },
    notifications: {
      enabled: true,
      endOfDay: '21:30',
      startupNudge: true,
      startupDelayMin: 5,
      maxPerHour: 4,
    },
    voice: {
      transcriptionModel: 'gpt-transcribe',
      baseUrl: '',
      aiInterpret: true,
      interpretModel: 'gpt-5-mini',
      keepAudio: false,
    },
  };
}

/** Deep-merge stored values over defaults so new settings get sane values after upgrades. */
export function mergeSettings(base: Settings, stored: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(stored)) {
    const b = (base as unknown as Record<string, unknown>)[k];
    out[k] =
      b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v)
        ? { ...b, ...(v as object) }
        : v;
  }
  return out as unknown as Settings;
}
