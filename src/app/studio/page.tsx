import Link from "next/link";
import RandomIdeaButton from "@/components/RandomIdeaButton";
import Studio from "@/components/Studio";
import { FAMILIES } from "@/lib/engine/catalog";
import { creativeProduct, defaultConfig, TEMPLATES, templateConfig } from "@/lib/engine/templates";

export const dynamic = "force-dynamic";

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const template = typeof sp.template === "string" ? sp.template : undefined;
  const random = typeof sp.random === "string" ? Number(sp.random) : undefined;
  const blank = sp.blank !== undefined;

  if (template) {
    const cfg = templateConfig(template);
    if (cfg) return <Studio key={`t-${template}`} initial={cfg} />;
  }
  if (random !== undefined && Number.isFinite(random)) return <Studio key={`r-${random}`} initial={creativeProduct(random)} />;
  if (blank) return <Studio key="blank" initial={defaultConfig()} />;

  const groups: ("credit" | "points" | "hybrid")[] = ["credit", "points", "hybrid"];
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white">
        <div className="hero-grid absolute inset-0" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black">🧪 کارگاه طراحی محصول</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">
              از یکی از ۱۵ الگوی مبتنی بر تحقیق بازار ایران شروع کنید، از صفر بسازید، یا بگذارید موتور ایده‌پرداز سیمرغ یک محصول خلاقانه بسازد.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <RandomIdeaButton className="rounded-xl bg-gradient-to-l from-fuchsia-500 to-amber-400 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg">
              🎲 ایده خلاقانه تصادفی
            </RandomIdeaButton>
            <Link href="/studio?blank=1" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold hover:bg-white/10">
              ✏️ طراحی از صفر
            </Link>
          </div>
        </div>
      </div>
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-slate-800">
            <span>{FAMILIES[g].emoji}</span> محصولات {FAMILIES[g].label}
            <span className="text-xs font-normal text-slate-500">— {FAMILIES[g].desc}</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.filter((t) => t.group === g).map((t) => (
              <Link
                key={t.key}
                href={`/studio?template=${t.key}`}
                className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl text-2xl" style={{ background: `${t.patch.color ?? "#6366f1"}22` }}>
                    {t.patch.emoji}
                  </span>
                  <div>
                    <div className="font-bold text-slate-800 group-hover:text-indigo-700">{t.title}</div>
                    <div className="text-xs text-slate-500">{t.patch.name}</div>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{t.patch.description}</p>
                <div className="mt-2 text-[11px] text-indigo-600">📎 الهام: {t.inspiration}</div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
