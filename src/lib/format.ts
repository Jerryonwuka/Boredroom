/** Small formatters shared by the Control Center pages. Money lives in `server/admin/billing` (money). */
export function bytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1, x = v;
  do { x /= 1024; i++; } while (x >= 1024 && i < u.length - 1);
  return `${x.toFixed(x >= 10 ? 0 : 1)} ${u[i]}`;
}

export function num(n: number | null | undefined): string { return Number(n ?? 0).toLocaleString("en-GB"); }

export function hours(h: number | null | undefined): string { const v = Number(h ?? 0); return v >= 10 ? `${Math.round(v)} h` : `${v.toFixed(1)} h`; }

export function money(amountMinor: number, currency = "NGN") {
  const symbol: Record<string, string> = { NGN: "₦", USD: "$", GBP: "£", EUR: "€", GHS: "GH₵", KES: "KSh", ZAR: "R" };
  return `${symbol[currency] ?? `${currency} `}${(amountMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function dateOnly(iso: string | null | undefined): string { return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
