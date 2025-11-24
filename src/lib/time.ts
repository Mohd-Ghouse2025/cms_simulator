type FormatOptions = {
  includeDate?: boolean;
  withSeconds?: boolean;
};

const buildFormatter = ({ includeDate, withSeconds }: FormatOptions = {}) =>
  new Intl.DateTimeFormat(undefined, {
    year: includeDate ? "numeric" : undefined,
    month: includeDate ? "short" : undefined,
    day: includeDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds === false ? undefined : "2-digit",
  });

export const toTimestamp = (value?: string | number | Date | null): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
};

export const formatLocalTimestamp = (
  value?: string | number | Date | null,
  options?: FormatOptions
): string => {
  const timestamp = toTimestamp(value);
  if (timestamp === null) {
    return "—";
  }
  const formatter = buildFormatter(options);
  return formatter.format(new Date(timestamp));
};
