import Link from "next/link";
import RandomIdeaButton from "@/components/RandomIdeaButton";
import { listProducts, type ProductItem } from "@/db/repo";
import { CBI, FAMILIES, KINDS } from "@/lib/engine/catalog";
import { TEMPLATES } from "@/lib/engine/templates";
import { fmt, money, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

function healthColor(h: number | null) {
  if (h === null) return "#94a3b8";
  return h >= 75 ? "#10b981" : h >= 55 ? "#f59e0b" : "#ef4444";
}

export default async function Home() {
  let items: ProductItem[] = [];
  let dbError: string | null = null;
  try {
    items = await listProducts();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  const simulated = items.filter((i) => i.latest).length;
  const avgHealth = items.length ? items.reduce((s, i) => s + (i.healthScore ?? 0), 0) / items.length : 0;

  const macro = [
    { label: "سقف نرخ سود تسهیلات", value: `${fmt(CBI.loanRateCap)}٪`, icon: "🏛️" },
    { label: "تورم سالانه (خرداد ۱۴۰۵)", value: `${fmt(CBI.inflation.khordad1405)}٪`, icon: "🔥" },
    { label: "نرخ بازار بین‌بانکی", value: `${fmt(CBI.interbank)}٪`, icon: "🔁" },
    { label: "سقف وام خرد و کارت اعتباری", value: `${fmt(CBI.microLoanCap)} م.ت`, icon: "💳" },
    { label: "سود سپرده یک‌ساله", value: `${fmt(CBI.deposits.oneYear, 1)}٪`, icon: "🐷" },
    { label: "نرخ سود واقعی", value: "منفی", icon: "📉" },
  ];
  const pipeline = [
    { icon: "🧬", title: "طراحی", text: "۱۵ الگوی مبتنی بر بازار ایران یا ایده خلاقانه تصادفی" },
    { icon: "👥", title: "جمعیت مصنوعی", text: "هزاران مشتری با درآمد، اشتغال، رتبه ۰ تا ۹۰۰ و رفتار واقعی" },
    { icon: "🧾", title: "اعتبارسنجی", text: "قواعد DTI، وثیقه، سن و PD قابل‌توضیح" },
    { icon: "🎲", title: "مونت‌کارلو", text: "شوک سیستماتیک واسیچک، فصلی‌شدن نکول و انتشار باس" },
    { icon: "🤖", title: "دستیار هوشمند", text: "سیستم خبره، قیمت‌گذاری ریسک‌محور و انطباق" },
    { icon: "🧠", title: "بهینه‌سازی", text: "جستجوی هوشمند و مرز پارتو با قید مقررات" },
  ];

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-2xl md:p-10">
        <div className="hero-grid absolute inset-0" />
        <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-indigo-600/40 blur-3xl" />
        <div className="absolute -bottom-24 right-10 h-72 w-72 rounded-full bg-fuchsia-600/30 blur-3xl" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs">شبیه‌ساز تولید محصولات بانکی • نسخه ۱۴۰۵</span>
            <h1 className="mt-4 text-3xl font-black leading-[1.4] md:text-5xl md:leading-[1.35]">
              کارخانه هوشمند
              <span className="bg-gradient-to-l from-amber-300 via-fuchsia-400 to-indigo-400 bg-clip-text text-transparent"> محصولات اعتباری و امتیازی</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
              محصول را طراحی کنید، روی بازار مصنوعی ایران با شبیه‌سازی مونت‌کارلو بیازمایید، در برابر ۷ سناریوی کلان استرس دهید،
              قیمت مبتنی بر ریسک بگیرید و بگذارید بهینه‌ساز هوشمند بهترین طراحی سازگار با مقررات بانک مرکزی را پیدا کند.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/studio" className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg hover:bg-indigo-50">🧪 طراحی محصول جدید</Link>
              <RandomIdeaButton className="rounded-xl bg-gradient-to-l from-fuchsia-500 to-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-lg">🎲 ایده خلاقانه</RandomIdeaButton>
              <Link href="/knowledge" className="rounded-xl border border-white/25 px-5 py-2.5 text-sm font-semibold hover:bg-white/10">📚 دانشنامه تحقیق</Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {macro.map((m) => (
              <div key={m.label} className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                <div className="text-xl">{m.icon}</div>
                <div className="mt-1 text-xl font-black">{m.value}</div>
                <div className="text-[11px] text-slate-400">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {pipeline.map((p, i) => (
          <div key={p.title} className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="absolute left-3 top-3 text-xs font-black text-slate-200">{fmt(i + 1)}</div>
            <div className="text-2xl">{p.icon}</div>
            <div className="mt-1 font-bold text-slate-800">{p.title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">{p.text}</div>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-black text-slate-900">🗂️ سبد محصولات طراحی‌شده</h2>
            <p className="text-sm text-slate-500">
              {fmt(items.length)} محصول • {fmt(simulated)} شبیه‌سازی‌شده • میانگین سلامت {fmt(avgHealth)}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/compare" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:text-indigo-700">⚖️ مقایسه</Link>
            <Link href="/studio" className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">+ محصول جدید</Link>
          </div>
        </div>
        {dbError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">خطای پایگاه داده: {dbError}</div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => {
            const s = (p.latest?.summary ?? {}) as Record<string, number | undefined>;
            const isLoyalty = p.config.kind === "loyalty";
            return (
              <div key={p.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-center gap-3 p-4" style={{ background: `linear-gradient(120deg, ${p.config.color}22, transparent)` }}>
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-white text-2xl shadow-sm">{p.config.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-extrabold text-slate-900">{p.name}</div>
                    <div className="truncate text-xs text-slate-500">{p.config.tagline}</div>
                    <div className="mt-1 flex gap-1 text-[10px]">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">{FAMILIES[p.config.family].label}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">{KINDS[p.config.kind].label}</span>
                    </div>
                  </div>
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-4 text-lg font-black" style={{ borderColor: healthColor(p.healthScore), color: healthColor(p.healthScore) }}>
                    {p.healthScore === null ? "—" : fmt(p.healthScore)}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 px-4 pb-3 text-center text-xs">
                  {p.latest ? (
                    <>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div className="text-slate-400">سود خالص</div>
                        <div className={`font-bold ${(s.netProfit ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{money(s.netProfit ?? 0)}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div className="text-slate-400">{isLoyalty ? "ROI" : "RAROC"}</div>
                        <div className="font-bold">{pct(isLoyalty ? s.loyaltyRoi : s.raroc, 0)}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div className="text-slate-400">{isLoyalty ? "انطباق" : "NPL"}</div>
                        <div className="font-bold">{isLoyalty ? fmt(s.compliance) : pct(s.nplEnd)}</div>
                      </div>
                    </>
                  ) : (
                    <div className="col-span-3 rounded-lg bg-amber-50 p-2 text-amber-700">هنوز شبیه‌سازی کامل اجرا نشده — امتیاز از پیش‌نمایش سریع</div>
                  )}
                </div>
                <div className="flex border-t border-slate-100 text-sm">
                  <Link href={`/products/${p.id}`} className="flex-1 py-2.5 text-center font-semibold text-indigo-700 hover:bg-indigo-50">🔬 آزمایشگاه</Link>
                  <Link href={`/studio/${p.id}`} className="flex-1 border-r border-slate-100 py-2.5 text-center text-slate-600 hover:bg-slate-50">✏️ ویرایش</Link>
                </div>
              </div>
            );
          })}
          {items.length === 0 && !dbError && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">هنوز محصولی ندارید. از کارگاه طراحی شروع کنید.</div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-black text-slate-900">⚡ شروع سریع با الگوهای پژوهش‌محور</h2>
        <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-2">
          {TEMPLATES.map((t) => (
            <Link key={t.key} href={`/studio?template=${t.key}`} className="min-w-52 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300">
              <div className="text-2xl">{t.patch.emoji}</div>
              <div className="mt-1 text-sm font-bold text-slate-800">{t.title}</div>
              <div className="text-[11px] leading-5 text-slate-500">{t.inspiration}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
