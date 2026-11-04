import type { ScheduleKind, ScheduleParams } from '../core/types';
import type { I18n } from '../i18n';

export const FREQ_LABEL = {
  daily: 'freqDaily',
  weekdays: 'freqWeekdays',
  weekends: 'freqWeekends',
  days_of_week: 'freqDays',
  times_per_week: 'freqTimesPerWeek',
  every_n_days: 'freqEveryN',
  days_of_month: 'freqDaysOfMonth',
} as const;

export function describeSchedule(kind: ScheduleKind, params: ScheduleParams, i18n: I18n, weekStart = 1): string {
  const { t, num, weekdayName } = i18n;
  switch (kind) {
    case 'daily':
      return t('freqDaily');
    case 'weekdays':
      return t('freqWeekdays');
    case 'weekends':
      return t('freqWeekends');
    case 'days_of_week': {
      const order = (d: number) => (d - weekStart + 7) % 7;
      return [...(params.days ?? [])].sort((a, b) => order(a) - order(b)).map((d) => weekdayName(d, 'short')).join(', ');
    }
    case 'times_per_week':
      return `${num(params.n ?? 1)} ${t('timesPerWeek')}`;
    case 'every_n_days':
      return t('everyNDays', { n: params.n ?? 1 });
    case 'days_of_month':
      return `${t('freqDaysOfMonth')}: ${(params.dates ?? []).map((d) => num(d)).join(', ')}`;
  }
}
