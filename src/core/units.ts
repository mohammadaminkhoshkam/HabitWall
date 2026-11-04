/** Canonical units. Habits may also use free-text units; those just display as typed. */
export const UNITS = {
  min: { label: 'min', steps: [5, 10] },
  pages: { label: 'pages', steps: [5, 10] },
  glasses: { label: 'glasses', steps: [1] },
  article: { label: 'article', steps: [1] },
  times: { label: 'times', steps: [1] },
  km: { label: 'km', steps: [1] },
  steps: { label: 'steps', steps: [1000, 2000] },
  words: { label: 'words', steps: [5, 10] },
  chapters: { label: 'chapters', steps: [1] },
} as const;

export type UnitKey = keyof typeof UNITS;

export function isUnitKey(u: string | null | undefined): u is UnitKey {
  return !!u && Object.prototype.hasOwnProperty.call(UNITS, u);
}

export function unitLabel(unit: string | null): string {
  if (!unit) return '';
  return isUnitKey(unit) ? UNITS[unit].label : unit;
}

export function defaultSteps(unit: string | null, target: number): number[] {
  if (isUnitKey(unit)) return [...UNITS[unit].steps].filter((s) => s < target || target <= 1);
  return target > 1 ? [1] : [];
}

/** Regex fragments (on normalized text) that identify each unit when spoken. */
export const UNIT_PATTERNS: Record<UnitKey | 'hour', RegExp> = {
  min: /^(min|mins|minute|minutes)$/,
  hour: /^(hour|hours|hr|hrs|h)$/,
  pages: /^(page|pages|pg)$/,
  glasses: /^(glass|glasses|cup|cups)$/,
  article: /^(article|articles|paper|papers)$/,
  times: /^(time|times|rep|reps)$/,
  km: /^(km|kilometer|kilometers|kilometre|kilometres)$/,
  steps: /^(step|steps)$/,
  words: /^(word|words)$/,
  chapters: /^(chapter|chapters)$/,
};
