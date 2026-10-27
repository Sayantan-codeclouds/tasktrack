// Calendar helpers in the team's timezone (APP_TIMEZONE). Days are "YYYY-MM-DD" strings.

export const appTimeZone = () => process.env.APP_TIMEZONE || "UTC";

/** The calendar day `d` falls on in `tz`. */
export function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Local wall-clock parts of `d` in `tz`. weekday: 0 = Sunday … 6 = Saturday. */
export function localParts(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { ymd: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, weekday };
}

function offsetMs(at: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime();
}

/** The instant local midnight starts on `ymd` in `tz`. */
export function startOfDay(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess), tz);
  const again = offsetMs(new Date(t), tz); // correct across DST changes
  if (guess - again !== t) t = guess - again;
  return new Date(t);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

/** Monday of the week containing `ymd`. */
export const weekStart = (ymd: string) => addDays(ymd, -((weekdayOf(ymd) + 6) % 7));

export const isYmd = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function formatDay(ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}
