export const compact = (n: number | null | undefined) => (n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(n)));
export const pct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(Number(n) * 100).toFixed(d)}%`);
export const date = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "—");
export const dateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
export const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toFixed(Number(n) < 1 ? 3 : 2)}`);

/** ISO timestamp n days from now (negative for the past). For per-request server rendering. */
export const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
