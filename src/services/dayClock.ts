import { logicalDay, minutesIntoDay, nextDayBoundary } from '../core/dates';
import { reloadAll, useApp } from '../state/store';

/**
 * Keeps `today` correct. Day instances are virtual, so a rollover is just "recompute":
 * no job can be missed if the app was closed or the machine slept at midnight.
 */
export function startDayClock(onNewDay?: (day: string) => void): () => void {
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    const { settings, today } = useApp.getState();
    const now = new Date();
    const day = logicalDay(now, settings.dayStartMinutes);
    useApp.setState({ minuteOfDay: minutesIntoDay(now, settings.dayStartMinutes) });
    if (day !== today) {
      useApp.setState({ today: day });
      void reloadAll().then(() => onNewDay?.(day));
    }
  };

  const arm = () => {
    clearTimeout(boundaryTimer);
    const now = new Date();
    const ms = nextDayBoundary(now, useApp.getState().settings.dayStartMinutes).getTime() - now.getTime();
    boundaryTimer = setTimeout(() => (check(), arm()), Math.min(ms + 500, 2 ** 31 - 1));
  };

  const tick = setInterval(check, 30_000); // also catches sleep / clock changes
  const onWake = () => (check(), arm());
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onWake);
  const unsub = useApp.subscribe((s, p) => {
    if (s.settings.dayStartMinutes !== p.settings.dayStartMinutes) onWake();
  });
  check();
  arm();

  return () => {
    clearInterval(tick);
    clearTimeout(boundaryTimer);
    window.removeEventListener('focus', onWake);
    document.removeEventListener('visibilitychange', onWake);
    unsub();
  };
}
