export default function Loading() {
  return <div role="status" aria-live="polite" className="space-y-4">
    <p className="text-sm text-slate-500">در حال آماده‌سازی میز کار…</p>
    <div className="h-48 animate-pulse rounded-3xl bg-slate-200" />
    <div className="grid gap-4 sm:grid-cols-3">{[1, 2, 3].map(n => <div key={n} className="h-36 animate-pulse rounded-2xl bg-slate-100" />)}</div>
  </div>;
}
