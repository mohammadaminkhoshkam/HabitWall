import { create } from 'zustand';
import type { HabitDraft } from '../core/types';
import type { Purpose } from '../services/voice';
import { broadcast, host } from '../platform';

interface WidgetUi {
  sheet: { purpose: Purpose; typing: boolean; key: number } | null;
}

export const useWidgetUi = create<WidgetUi>(() => ({ sheet: null }));

let seq = 0;
export function openSheet(purpose: Purpose, typing = false) {
  useWidgetUi.setState({ sheet: { purpose, typing, key: ++seq } });
}
export function closeSheet() {
  useWidgetUi.setState({ sheet: null });
}

const PENDING = 'hw:pending-edit';

/** Opens the full editor in the dashboard (for "Edit" and "More options"). */
export async function editInDashboard(id: string | null, draft?: HabitDraft) {
  const payload = { id, draft, at: Date.now() };
  try {
    localStorage.setItem(PENDING, JSON.stringify(payload));
  } catch {
    /* the bus message below still works when the dashboard is open */
  }
  await host.openDashboard('habits');
  await broadcast({ type: 'edit-habit', id, draft });
}

export function takePendingEdit(): { id: string | null; draft?: HabitDraft } | null {
  try {
    const raw = localStorage.getItem(PENDING);
    if (!raw) return null;
    localStorage.removeItem(PENDING);
    const p = JSON.parse(raw);
    return Date.now() - p.at < 60_000 ? p : null;
  } catch {
    return null;
  }
}
