import { SCENARIOS } from "@/lib/engine/catalog";
import { DEFAULT_PARAMS } from "@/lib/engine/simulator";
import type { ScenarioId, SimParams } from "@/lib/engine/types";

export interface UiParams {
  customers: number;
  runs: number;
  seed: number;
  scenario: ScenarioId;
  horizon: number;
  marketRate: number;
  marketSize: number;
  inflation?: number | null;
}

export const DEFAULT_UI_PARAMS: UiParams = {
  customers: DEFAULT_PARAMS.customers,
  runs: DEFAULT_PARAMS.runs,
  seed: DEFAULT_PARAMS.seed,
  scenario: "base",
  horizon: DEFAULT_PARAMS.horizon,
  marketRate: DEFAULT_PARAMS.marketRate,
  marketSize: 1_000_000,
  inflation: null,
};

export function sanitizeParams(input: unknown): SimParams {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = Number(v);
    return v !== null && v !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const customers = Math.round(num(p.customers, DEFAULT_PARAMS.customers, 500, 10000));
  const marketSize = num(p.marketSize, 1_000_000, 10_000, 50_000_000);
  const scenario = (typeof p.scenario === "string" && Object.hasOwn(SCENARIOS, p.scenario) ? p.scenario : "base") as ScenarioId;
  const inflation = p.inflation === undefined || p.inflation === null || p.inflation === "" ? undefined : num(p.inflation, 50, 0, 200);
  return {
    customers,
    runs: Math.round(num(p.runs, DEFAULT_PARAMS.runs, 1, 60)),
    seed: Math.round(num(p.seed, DEFAULT_PARAMS.seed, 1, 999999)),
    scenario,
    horizon: Math.round(num(p.horizon, DEFAULT_PARAMS.horizon, 12, 60)),
    marketRate: num(p.marketRate, DEFAULT_PARAMS.marketRate, 5, 60),
    scale: marketSize / customers,
    inflation,
  };
}
