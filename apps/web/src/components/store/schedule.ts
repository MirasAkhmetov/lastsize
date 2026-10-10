import { WEEKDAYS, type Weekday } from '@lastsize/contracts';

/** Today's weekday in Almaty, regardless of the server's time zone. */
export function todayInAlmaty(now = new Date()): Weekday {
  const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Almaty' })
    .format(now)
    .toLowerCase();
  return (WEEKDAYS.find((day) => name.startsWith(day)) ?? 'mon') as Weekday;
}

export function formatIntervals(intervals: [string, string][] | undefined): string | null {
  if (!intervals || intervals.length === 0) return null;
  return intervals.map(([from, to]) => `${from}–${to}`).join(', ');
}
