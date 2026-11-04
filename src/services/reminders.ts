import { planReminders } from '../core/reminders';
import { notify } from '../platform';
import { getRepo, useApp } from '../state/store';

/** Runs in the widget window only (it is never destroyed, just hidden). */
export function startReminders(): () => void {
  const appStartedAt = new Date();
  const sent: number[] = [];
  let running = false;

  const run = async () => {
    const s = useApp.getState();
    if (running || !s.ready || !s.settings.notifications.enabled) return;
    running = true;
    try {
      const repo = getRepo();
      const [rules, fired] = await Promise.all([repo.listReminders(), repo.firedReminders(s.today)]);
      const plan = planReminders({
        now: new Date(),
        today: s.today,
        minuteOfDay: s.minuteOfDay,
        dayStartMinutes: s.settings.dayStartMinutes,
        habits: s.habits,
        checkins: s.checkins,
        ctx: { weekendDays: s.settings.weekendDays, weekStart: s.settings.weekStart },
        rules,
        fired,
        endOfDay: s.settings.notifications.endOfDay,
        startupNudge: s.settings.notifications.startupNudge,
        startupDelayMin: s.settings.notifications.startupDelayMin,
        appStartedAt,
      });

      const { t, amount } = s.i18n;
      for (const p of plan) {
        // Never spam: hourly cap across all reminders.
        const hourAgo = Date.now() - 3_600_000;
        while (sent.length && sent[0] < hourAgo) sent.shift();
        if (sent.length >= s.settings.notifications.maxPerHour) break;

        // Logging first makes this idempotent across restarts and windows.
        if (!(await repo.logReminder(p.key, s.today))) continue;
        if (p.clearSnoozeOf) await repo.snoozeHabitReminders(p.habitIds[0], null);

        const habits = p.habitIds.map((id) => s.habits.find((h) => h.id === id)!).filter(Boolean);
        if (!habits.length) continue;
        const first = habits[0];
        if (p.kind === 'habit') {
          const goal = first.kind === 'count' ? ` — ${amount(first.targetValue, first.unit)}` : '';
          await notify(`${first.icon ?? '🔴'} ${t('nTime', { title: first.title })}`, `${first.title}${goal}`);
        } else if (p.kind === 'end_of_day') {
          const sep = ', ';
          await notify('HabitWall', t('nOpen', { list: habits.map((h) => h.title).join(sep) }));
        } else {
          await notify('HabitWall', t('nStartup', { n: habits.length, title: first.title }));
        }
        sent.push(Date.now());
      }
    } catch (e) {
      console.warn('reminders', e);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(run, 30_000);
  const first = setTimeout(run, 4_000);
  return () => (clearInterval(timer), clearTimeout(first));
}
