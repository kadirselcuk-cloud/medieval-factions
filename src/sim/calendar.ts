/**
 * The campaign calendar, derived entirely from an integer tick count.
 *
 * Nothing here reads a clock or stores a date — a tick number is the only time state that
 * exists, which is what makes a save exact and the speed multiplier free of side effects.
 * See docs/MECHANICS.md §1.
 */

export const TICKS_PER_DAY = 4;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH; // 120
export const START_YEAR = 1350;

export const PHASE_NAMES = ['Night', 'Morning', 'Noon', 'Evening'] as const;
export type Phase = (typeof PHASE_NAMES)[number];

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export const SEASON_LABEL: Record<Season, string> = {
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
};

/** docs/MECHANICS.md §5. Multipliers, plus a flat addition to defender's advantage. */
export const SEASON_EFFECTS: Record<
  Season,
  { movement: number; farmIncome: number; defenderBonus: number }
> = {
  winter: { movement: 0.6, farmIncome: 0.4, defenderBonus: 0.1 },
  spring: { movement: 1, farmIncome: 1, defenderBonus: 0 },
  summer: { movement: 1, farmIncome: 1, defenderBonus: 0 },
  autumn: { movement: 1, farmIncome: 1.25, defenderBonus: 0 },
};

const SEASON_BY_MONTH: readonly Season[] = [
  'winter', // January
  'winter', // February
  'spring',
  'spring',
  'spring',
  'summer',
  'summer',
  'summer',
  'autumn',
  'autumn',
  'autumn',
  'winter', // December
];

export interface CalendarDate {
  year: number;
  /** 0-based index into MONTH_NAMES. */
  monthIndex: number;
  monthName: string;
  /** 1-based day of month, 1..30. */
  day: number;
  phase: Phase;
  phaseIndex: number;
  season: Season;
  /** Progress through the current month, 0..1 — drives the month gauge. */
  monthProgress: number;
  /** Months elapsed since the campaign started. */
  totalMonths: number;
}

export function calendarAt(tick: number): CalendarDate {
  const totalMonths = Math.floor(tick / TICKS_PER_MONTH);
  const tickInMonth = tick % TICKS_PER_MONTH;
  const monthIndex = totalMonths % MONTHS_PER_YEAR;

  return {
    year: START_YEAR + Math.floor(totalMonths / MONTHS_PER_YEAR),
    monthIndex,
    monthName: MONTH_NAMES[monthIndex] ?? '—',
    day: Math.floor(tickInMonth / TICKS_PER_DAY) + 1,
    phase: PHASE_NAMES[tick % TICKS_PER_DAY] ?? 'Night',
    phaseIndex: tick % TICKS_PER_DAY,
    season: SEASON_BY_MONTH[monthIndex] ?? 'spring',
    monthProgress: tickInMonth / TICKS_PER_MONTH,
    totalMonths,
  };
}

export function isMonthBoundary(tick: number): boolean {
  return tick % TICKS_PER_MONTH === 0;
}
