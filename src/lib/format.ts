const NF = [0, 1, 2].map((d) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: d }));

export function fmt(v: number | null | undefined, d = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return NF[Math.min(2, Math.max(0, d))].format(v);
}

export function pct(v: number | null | undefined, d = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${fmt(v, d)}٪`;
}

/** input in billion toman */
export function money(billion: number | null | undefined): string {
  if (billion === null || billion === undefined || !Number.isFinite(billion)) return "—";
  const a = Math.abs(billion);
  if (a >= 1000) return `${fmt(billion / 1000, 1)} همت`;
  if (a >= 1) return `${fmt(billion, a >= 100 ? 0 : 1)} میلیارد تومان`;
  return `${fmt(billion * 1000, 0)} میلیون تومان`;
}

/** compact axis label for billion-toman values */
export function axisMoney(billion: number): string {
  const a = Math.abs(billion);
  if (a >= 1000) return `${fmt(billion / 1000, 1)}همت`;
  return fmt(billion, a < 10 ? 1 : 0);
}

/** input in million toman */
export function mt(million: number | null | undefined, d = 0): string {
  if (million === null || million === undefined || !Number.isFinite(million)) return "—";
  if (Math.abs(million) >= 1000) return `${fmt(million / 1000, 2)} میلیارد تومان`;
  return `${fmt(million, d)} میلیون تومان`;
}

export function count(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${fmt(n / 1e6, 2)} میلیون`;
  if (a >= 1e3) return `${fmt(n / 1e3, 1)} هزار`;
  return fmt(n);
}

export function faDate(iso: string | Date): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}
