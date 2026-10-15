// Keep CreationDate.ToString("o") intact: converting through JavaScript Date
// would discard sub-millisecond ticks and can normalize invalid calendar dates.
export function validateProcessCreation(value) {
  const timestamp = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{7}(?:Z|[+-](\d{2}):(\d{2}))?$/.exec(value)
    : null;
  if (!timestamp || timestamp[0] !== value) {
    throw new Error("独立验收 creation 必须是 CreationDate 的 round-trip o 字符串");
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText = "0", offsetMinuteText = "0"] = timestamp;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    [yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText].map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1601 || month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 14 || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)) {
    throw new Error("独立验收 creation 时间无效");
  }
  return value;
}
