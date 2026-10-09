"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarsChart, DnaRadar } from "@/components/charts";
import { Card, Select, Spinner } from "@/components/ui";
import { analyzeResult } from "@/lib/engine/advisor";
import { KINDS, SCENARIOS } from "@/lib/engine/catalog";
import { QUICK_PARAMS, simulatePortfolio } from "@/lib/engine/simulator";
import type { FullResult, ProductConfig, ScenarioId } from "@/lib/engine/types";
import { axisMoney, fmt, money, pct } from "@/lib/format";

interface Item {
  id: number;
  name: string;
  config: ProductConfig;
  healthScore: number | null;
}

type Row = { label: string; get: (r: FullResult) => number; fmt: (v: number) => string; better: "high" | "low" };

const ROWS: Row[] = [
  { label: "امتیاز سلامت", get: (r) => r.health.score, fmt: (v) => fmt(v), better: "high" },
  { label: "سود خالص", get: (r) => r.sim.kpis.netProfit, fmt: money, better: "high" },
  { label: "سود واقعی (تعدیل تورم)", get: (r) => r.sim.kpis.realProfit, fmt: money, better: "high" },
  { label: "RAROC", get: (r) => r.sim.kpis.raroc, fmt: (v) => pct(v, 0), better: "high" },
  { label: "NPL پایدار", get: (r) => r.sim.kpis.nplEnd, fmt: (v) => pct(v), better: "low" },
  { label: "نرخ تأیید", get: (r) => r.sim.kpis.approvalRate, fmt: (v) => pct(v, 0), better: "high" },
  { label: "نرخ مؤثر مشتری", get: (r) => r.sim.kpis.apr, fmt: (v) => pct(v), better: "low" },
  { label: "شمول مالی", get: (r) => r.sim.kpis.inclusion, fmt: (v) => pct(v, 0), better: "high" },
  { label: "احتمال زیان", get: (r) => r.sim.profitDist.probLoss, fmt: (v) => pct(v, 0), better: "low" },
  { label: "امتیاز انطباق", get: (r) => r.compliance.score, fmt: (v) => fmt(v), better: "high" },
];

export default function ComparePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [scenario, setScenario] = useState<ScenarioId>("base");
  const [results, setResults] = useState<Record<number, FullResult>>({});
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => { if (!r.ok) throw new Error("دریافت محصولات ناموفق بود. اتصال سرور را بررسی و صفحه را تازه‌سازی کنید."); return r.json(); })
      .then((j: { items?: Item[] }) => {
        const list = j.items ?? [];
        setItems(list);
        setSel(list.slice(0, 3).map((i) => i.id));
        setLoaded(true);
      })
      .catch((e) => { setError(e instanceof Error ? e.message : "خطای ارتباط"); setLoaded(true); });
  }, []);

  useEffect(() => {
    if (!items.length || !sel.length) return;
    let workTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setRunning(true);
      workTimer = setTimeout(() => {
        const out: Record<number, FullResult> = {};
        for (const id of sel) {
          const it = items.find((i) => i.id === id);
          if (!it) continue;
          out[id] = analyzeResult(it.config, simulatePortfolio(it.config, { ...QUICK_PARAMS, customers: 2000, runs: 6, scenario, scale: 500 }));
        }
        setResults(out);
        setRunning(false);
      }, 0);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (workTimer) clearTimeout(workTimer);
    };
  }, [items, sel, scenario]);

  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));
  const chosen = sel.map((id) => items.find((i) => i.id === id)).filter((x): x is Item => !!x && !!results[x.id]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">⚖️ مقایسه محصولات</h1>
          <p className="text-sm text-slate-500">تا ۴ محصول را در شرایط یکسان بازار و سناریوی کلان مقایسه کنید (شبیه‌سازی در مرورگر).</p>
        </div>
        <div className="w-72">
          <Select<ScenarioId> label="سناریوی مشترک" value={scenario} onChange={setScenario} options={(Object.keys(SCENARIOS) as ScenarioId[]).map((s) => ({ value: s, label: SCENARIOS[s].label }))} />
        </div>
      </div>

      <Card title="انتخاب محصولات" icon="✅" actions={running ? <span className="flex items-center gap-1 text-xs text-indigo-600"><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" /> محاسبه…</span> : null}>
        {!loaded && <div className="py-4 text-center text-sm text-slate-500"><Spinner /> بارگذاری…</div>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
        {loaded && !error && items.length === 0 && (
          <div className="py-4 text-center text-sm text-slate-500">محصولی وجود ندارد. <Link href="/studio" className="text-indigo-600">طراحی کنید</Link></div>
        )}
        <div className="flex flex-wrap gap-2">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => toggle(it.id)}
              className={`rounded-xl border px-3 py-2 text-sm transition ${sel.includes(it.id) ? "border-transparent text-white shadow" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300"}`}
              style={sel.includes(it.id) ? { background: it.config.color } : undefined}
            >
              {it.config.emoji} {it.name}
              <span className="mr-1 text-[10px] opacity-80">({KINDS[it.config.kind].label})</span>
            </button>
          ))}
        </div>
      </Card>

      {chosen.length > 0 && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="DNA مقایسه‌ای" icon="🧬">
              <DnaRadar
                axes={results[chosen[0].id].dna.map((d) => d.axis)}
                series={chosen.map((c) => ({ name: c.name, color: c.config.color, values: results[c.id].dna.map((d) => d.value) }))}
                height={340}
              />
            </Card>
            <Card title="سود خالص در سناریوی انتخابی" icon="💰">
              <BarsChart
                data={chosen.map((c) => ({ name: c.name, profit: results[c.id].sim.kpis.netProfit, color: c.config.color }))}
                xKey="name"
                yFmt={axisMoney}
                series={[{ key: "profit", label: "سود خالص", color: "#6366f1" }]}
                colorBy={(r) => String(r.color)}
                height={340}
              />
            </Card>
          </div>
          <Card title="جدول شاخص‌ها" icon="📋" subtitle="خانه سبز = بهترین در هر شاخص">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-right text-slate-500">شاخص</th>
                    {chosen.map((c) => (
                      <th key={c.id} className="p-2 text-center">
                        <span className="text-lg">{c.config.emoji}</span>
                        <div className="text-xs font-bold" style={{ color: c.config.color }}>{c.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => {
                    const vals = chosen.map((c) => row.get(results[c.id]));
                    const best = row.better === "high" ? Math.max(...vals) : Math.min(...vals);
                    return (
                      <tr key={row.label} className="border-b border-slate-50">
                        <td className="p-2 text-slate-600">{row.label}</td>
                        {vals.map((v, i) => (
                          <td key={chosen[i].id} className={`p-2 text-center font-semibold ${v === best && chosen.length > 1 ? "rounded-lg bg-emerald-50 text-emerald-700" : ""}`}>
                            {row.fmt(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
