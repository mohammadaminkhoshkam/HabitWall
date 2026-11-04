/*
 * Everything that touches the host (Tauri or a plain browser) goes through here,
 * so the rest of the app is host-agnostic and the UI can be previewed in a browser.
 */
import type { Db } from '../data/db';
import type { WidgetMode } from '../data/settings';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type WindowKind = 'widget' | 'dashboard';

export async function currentWindowKind(): Promise<WindowKind> {
  if (isTauri) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow().label === 'dashboard' ? 'dashboard' : 'widget';
  }
  return location.hash.startsWith('#dashboard') ? 'dashboard' : 'widget';
}

export async function createDb(): Promise<Db> {
  if (isTauri) {
    const { TauriDb } = await import('../data/tauriDb');
    return new TauriDb();
  }
  const [{ default: initSqlJs }, { default: wasmUrl }, { SqlJsDb }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
    import('../data/sqljsDb'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return SqlJsDb.create(SQL, 'habitwall-preview-db');
}

// ------------------------------------------------------------ cross-window bus

export type BusEvent =
  | { type: 'data'; scope: 'habits' | 'checkins' | 'settings' | 'focus' | 'inbox' | 'all' }
  | { type: 'edit-habit'; id: string | null; draft?: unknown }
  | { type: 'nav'; route: string };

const BUS = 'hw:bus';
const senderId = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;

export async function broadcast(evt: BusEvent): Promise<void> {
  if (isTauri) {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(BUS, { from: senderId, evt });
  } else {
    channel ??= new BroadcastChannel(BUS);
    channel.postMessage({ from: senderId, evt });
  }
}

export async function onBus(cb: (evt: BusEvent) => void): Promise<() => void> {
  if (isTauri) {
    const { listen } = await import('@tauri-apps/api/event');
    const un1 = await listen<{ from: string; evt: BusEvent }>(BUS, (e) => {
      if (e.payload.from !== senderId) cb(e.payload.evt);
    });
    // Events emitted by Rust (tray menu, show_dashboard route)
    const un2 = await listen<string>('nav', (e) => cb({ type: 'nav', route: e.payload }));
    return () => (un1(), un2());
  }
  const ch = new BroadcastChannel(BUS);
  ch.onmessage = (m) => m.data?.from !== senderId && cb(m.data.evt);
  return () => ch.close();
}

export async function onTray(cb: (action: 'voice' | 'new_habit') => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<'voice' | 'new_habit'>('tray', (e) => cb(e.payload));
}

// ------------------------------------------------------------ windows

async function win() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export const host = {
  async showSelf() {
    if (!isTauri) return;
    const w = await win();
    await w.show();
  },
  async hideSelf() {
    if (!isTauri) return;
    await (await win()).hide();
  },
  async toggleSelf() {
    if (!isTauri) return;
    const w = await win();
    if (await w.isVisible()) await w.hide();
    else {
      await w.show();
      await w.setFocus();
    }
  },
  async startDrag() {
    if (isTauri) await (await win()).startDragging();
  },
  async startResize() {
    if (isTauri) await (await win()).startResizeDragging('SouthEast' as never);
  },
  async setWidgetMode(mode: WidgetMode) {
    if (!isTauri) return;
    const w = await win();
    await w.setAlwaysOnTop(mode === 'top');
    await w.setAlwaysOnBottom(mode === 'desktop');
  },
  /** Real desktop blur behind the Glass theme (Windows acrylic). */
  async setGlass(on: boolean) {
    if (!isTauri) return;
    const w = await win();
    try {
      if (on) {
        const { Effect } = await import('@tauri-apps/api/window');
        await w.setEffects({ effects: [Effect.Acrylic] });
      } else {
        await w.clearEffects();
      }
    } catch (e) {
      console.warn('window effects unavailable', e);
    }
  },
  async openDashboard(route?: string) {
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('show_dashboard', { route: route ?? null });
    } else {
      window.open(`#dashboard${route ? '/' + route : ''}`, 'habitwall-dashboard');
      if (route) void broadcast({ type: 'nav', route });
    }
  },
  async quit() {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('quit_app');
  },
  async setTrayLabels(labels: { toggle: string; dashboard: string; voice: string; newHabit: string; quit: string }) {
    if (!isTauri) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_tray_labels', { labels }).catch(() => {});
  },
};

// ------------------------------------------------------------ notifications

let notifyPermission: boolean | null = null;

export async function notify(title: string, body: string): Promise<void> {
  if (isTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    if (notifyPermission == null) {
      notifyPermission = await n.isPermissionGranted();
      if (!notifyPermission) notifyPermission = (await n.requestPermission()) === 'granted';
    }
    if (notifyPermission) n.sendNotification({ title, body });
    return;
  }
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted') new Notification(title, { body });
}

// ------------------------------------------------------------ global shortcuts

/** Registers OS-wide shortcuts (desktop) or in-page key handlers (browser). Returns an unregister fn. */
export async function registerShortcuts(map: Record<string, () => void>): Promise<() => void> {
  const entries = Object.entries(map).filter(([k]) => !!k);
  if (isTauri) {
    const gs = await import('@tauri-apps/plugin-global-shortcut');
    await gs.unregisterAll().catch(() => {});
    for (const [accel, fn] of entries) {
      await gs
        .register(accel, (e) => {
          if (e.state === 'Pressed') fn();
        })
        .catch((err) => console.warn('shortcut failed', accel, err));
    }
    return () => void gs.unregisterAll().catch(() => {});
  }
  const handler = (e: KeyboardEvent) => {
    for (const [accel, fn] of entries) if (matchesAccelerator(e, accel)) (e.preventDefault(), fn());
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

export function matchesAccelerator(e: KeyboardEvent, accel: string): boolean {
  const parts = accel.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const want = (m: string) => parts.includes(m);
  const ctrl = want('commandorcontrol') || want('ctrl') || want('control');
  return (
    e.key.toLowerCase() === key &&
    (e.ctrlKey || e.metaKey) === ctrl &&
    e.shiftKey === want('shift') &&
    e.altKey === want('alt')
  );
}

/** KeyboardEvent → Tauri accelerator string, for the shortcut recorder. */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mods.length) return null;
  const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.code;
  return [...mods, key].join('+');
}

// ------------------------------------------------------------ autostart

export async function setAutostart(on: boolean): Promise<void> {
  if (!isTauri) return;
  const a = await import('@tauri-apps/plugin-autostart');
  if (on) await a.enable();
  else await a.disable();
}

// ------------------------------------------------------------ secrets & voice (Rust side)

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export const secrets = {
  set: (name: string, value: string) => invoke<void>('secret_set', { name, value }),
  has: (name: string) => (isTauri ? invoke<boolean>('secret_has', { name }) : Promise.resolve(false)),
  remove: (name: string) => invoke<void>('secret_delete', { name }),
};

export interface TranscribeArgs {
  audioB64: string;
  mime: string;
  model: string;
  baseUrl?: string;
  languages: string[];
  prompt?: string;
  keywords: string[];
}

export const voiceApi = {
  transcribe: (args: TranscribeArgs) => invoke<{ text: string; model: string }>('voice_transcribe', { args }),
  interpret: (args: { model: string; baseUrl?: string; system: string; user: string; schema: unknown }) =>
    invoke<string>('voice_interpret', { args }),
  saveAudio: (id: string, audioB64: string, ext: string) => invoke<string>('voice_save_audio', { id, audioB64, ext }),
};
