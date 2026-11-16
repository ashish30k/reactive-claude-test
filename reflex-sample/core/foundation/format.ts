/** Display formatting lives in the core so every host shows identical text. */
export interface Money {
  amount: string;
  currencyCode: string;
}

export function formatMoney(m: Money, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currencyCode }).format(Number(m.amount));
}

export function sumMoney(items: Money[], currencyCode: string): Money {
  const cents = items.reduce((acc, m) => acc + Math.round(Number(m.amount) * 100), 0);
  return { amount: (cents / 100).toFixed(2), currencyCode };
}

/** "Today at 2:14 PM", "Yesterday at 9:02 AM", or "Nov 12 at 4:00 PM". */
export function formatOrderDate(iso: string, now: Date, timeZone: string, locale: string): string {
  const date = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d); // YYYY-MM-DD
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (day(date) === day(now)) return `Today at ${time}`;
  if (day(date) === day(yesterday)) return `Yesterday at ${time}`;
  const md = new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" }).format(date);
  return `${md} at ${time}`;
}

/** Start of "today" in the shop's time zone, as an ISO string (for search queries). */
export function startOfDayISO(now: Date, timeZone: string): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  // Offset of the zone at `now`, e.g. "GMT-05:00".
  const offsetPart = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  const offset = !offsetPart || offsetPart === "GMT" ? "+00:00" : offsetPart.replace("GMT", "");
  return new Date(`${ymd}T00:00:00${offset}`).toISOString();
}

/** Shopify's display enums -> merchant-facing labels. */
export function humanize(enumValue: string): string {
  const s = enumValue.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** gid://shopify/Order/1001 -> "1001" */
export function legacyId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}
