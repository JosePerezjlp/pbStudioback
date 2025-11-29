import { DateTime } from "luxon";

export const MX_ZONE = "America/Mexico_City";

export const nowMx = (): DateTime => DateTime.now().setZone(MX_ZONE);

const toDateTimeMx = (v?: Date | string | DateTime): DateTime => {
  if (!v) return nowMx();
  if (v instanceof Date) return DateTime.fromJSDate(v).setZone(MX_ZONE);
  if (typeof v === "string") return DateTime.fromISO(v).setZone(MX_ZONE);
  return v.setZone(MX_ZONE);
};

export const fromIsoMx = (iso: string): DateTime => DateTime.fromISO(iso, { zone: MX_ZONE });

export const startOfDayMx = (v?: Date | string | DateTime): DateTime => toDateTimeMx(v).startOf("day");

export const endOfDayMx = (v?: Date | string | DateTime): DateTime => toDateTimeMx(v).endOf("day");

export const mxDayRangeUtc = (v?: Date | string | DateTime): { startIso: string; endIso: string; date: string } => {
  const dt = toDateTimeMx(v);
  return {
    startIso: dt.startOf("day").toUTC().toISO() || "",
    endIso: dt.endOf("day").toUTC().toISO() || "",
    date: dt.toISODate() || "",
  };
};

export const minutesUntilClassMx = (day: string, hour: string): number => {
  const start = fromIsoMx(`${day}T${hour}:00`);
  const now = nowMx();
  return Math.floor((start.toMillis() - now.toMillis()) / 60000);
};

export const formatDateVisibleMx = (dayYmd: string): string =>
  new Date(`${dayYmd}T00:00:00`).toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: MX_ZONE,
  });
