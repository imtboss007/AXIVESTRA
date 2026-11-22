const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parseMonth(value) {
  const match = MONTH_PATTERN.exec(String(value || ""));
  if (!match) throw new TypeError("Month must use YYYY-MM format.");
  const year = Number(match[1]);
  if (year < 1000 || year > 9999) throw new RangeError("Month year must be between 1000 and 9999.");
  return { year, monthIndex: Number(match[2]) - 1 };
}

function formatDateKey(year, monthIndex, day) {
  return String(year).padStart(4, "0") + "-" +
    String(monthIndex + 1).padStart(2, "0") + "-" +
    String(day).padStart(2, "0");
}

export function buildMonthGrid(month) {
  const { year, monthIndex } = parseMonth(month);
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) return null;
    return { day, date: formatDateKey(year, monthIndex, day) };
  });
}

export function shiftMonth(month, offset) {
  const { year, monthIndex } = parseMonth(month);
  if (!Number.isInteger(offset)) throw new TypeError("Month offset must be an integer.");
  const shifted = new Date(year, monthIndex + offset, 1);
  const nextYear = shifted.getFullYear();
  if (nextYear < 1000 || nextYear > 9999) throw new RangeError("Shifted month is outside the supported year range.");
  return String(nextYear).padStart(4, "0") + "-" + String(shifted.getMonth() + 1).padStart(2, "0");
}

export function formatMonthLabel(month, locale = "en-IN") {
  const { year, monthIndex } = parseMonth(month);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, monthIndex, 1));
}
