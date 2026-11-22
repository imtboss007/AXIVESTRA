export type FollowUpCalendarDay = { day: number; date: string };

export function buildMonthGrid(month: string): Array<FollowUpCalendarDay | null>;
export function shiftMonth(month: string, offset: number): string;
export function formatMonthLabel(month: string, locale?: string): string;
