export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function daysInMonth(yyyyMm: string) {
  const [y, m] = yyyyMm.split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m, 0));
  return d.getUTCDate();
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function dateFromMonthDay(yyyyMm: string, day: number) {
  return `${yyyyMm}-${pad2(day)}`;
}

export function dayOfMonthInTimeZone(timeZone: string, date = new Date()) {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "2-digit",
  }).format(date);
  return Number(part);
}

export function weekdayInTimeZone(timeZone: string, isoDate: string) {
  const [y, m, d] = isoDate.split("-").map((v) => Number(v));
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
}
