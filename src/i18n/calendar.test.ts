import { describe, expect, it } from 'vitest';
import { monthDays, monthStart, monthTitle, shiftMonth } from './calendar';

describe('month grids', () => {
  it('finds month boundaries', () => {
    expect(monthStart('2026-10-03')).toBe('2026-10-01');
    expect(monthDays('2026-10-03')).toHaveLength(31);
    expect(monthDays('2026-02-10')).toHaveLength(28);
    expect(monthDays('2024-02-10')).toHaveLength(29); // leap year
  });

  it('moves across months and years', () => {
    expect(shiftMonth('2026-10-03', 1)).toBe('2026-11-01');
    expect(shiftMonth('2026-10-03', -1)).toBe('2026-09-01');
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01');
    expect(monthTitle('2026-10-03')).toBe('October 2026');
  });
});
