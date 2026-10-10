// Tests for the features added after the 2026-10-10 audit:
// liquidity-adjusted RAROC, ALM run persistence helpers and designer constraints.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compactAlmResult, customerAllInCost, pmtFor, runFullAlmAnalysis, summarizeAlm } from "../src/lib/engine/alm";
import { checkCompliance, generateInsights } from "../src/lib/engine/advisor";
import { LIQUIDITY } from "../src/lib/engine/catalog";
import { DEFAULT_PARAMS, simulatePortfolio } from "../src/lib/engine/simulator";
import { templateConfig } from "../src/lib/engine/templates";

const sim = (key: string) => simulatePortfolio(templateConfig(key)!, { ...DEFAULT_PARAMS, customers: 2500, runs: 3 });

test("liquidity-adjusted RAROC: points products split franchise from credit", () => {
  for (const key of ["negin_farapuya", "resalat_points", "nikvam_points"]) {
    const k = sim(key).kpis;
    assert.ok(k.liquidityCost > 0, `${key}: liquidity cost`);
    assert.ok(k.liquidityCapital > 0, `${key}: liquidity capital`);
    // Stripping the FTP benefit can only lower the return; charging liquidity can only lower it too.
    assert.ok(k.rarocCredit < k.raroc, `${key}: credit-only < headline`);
    assert.ok(k.rarocLiquidity < k.raroc, `${key}: liquidity-adjusted < headline`);
    assert.ok(Number.isFinite(k.rarocCredit) && Number.isFinite(k.rarocLiquidity));
  }
  assert.equal(LIQUIDITY.stressRunoff > LIQUIDITY.bufferRunoff, true);
});

test("liquidity-adjusted RAROC equals RAROC for non-points products", () => {
  const k = sim("murabaha_card").kpis;
  assert.equal(k.liquidityCost, 0);
  assert.equal(k.liquidityCapital, 0);
  assert.ok(Math.abs(k.rarocCredit - k.raroc) < 1e-9);
  assert.ok(Math.abs(k.rarocLiquidity - k.raroc) < 1e-9);
});

test("franchise insight fires when value comes only from the deposit franchise", () => {
  const cfg = templateConfig("negin_farapuya")!;
  const r = sim("negin_farapuya");
  assert.ok(r.kpis.raroc > 0 && r.kpis.rarocCredit < 0, "Negin earns only through the deposit franchise");
  const ins = generateInsights(cfg, r, checkCompliance(cfg));
  assert.ok(ins.some((i) => i.id === "franchise"));
  const card = templateConfig("murabaha_card")!;
  assert.ok(!generateInsights(card, sim("murabaha_card"), checkCompliance(card)).some((i) => i.id === "franchise"));
});

test("summarizeAlm / compactAlmResult produce a storable, comparable snapshot", () => {
  const cfg = templateConfig("negin_farapuya")!;
  const params = { marketShare: 2, horizon: 48, scenario: "stress" as const };
  const full = runFullAlmAnalysis({ product: cfg, ...params });
  const s = summarizeAlm(full, params, cfg);
  assert.equal(s.scenario, "stress");
  assert.equal(s.horizon, 48);
  assert.equal(s.maxHole, full.alm.kpis.maxHole);
  assert.ok(Array.isArray(s.tiers) && (s.tiers as unknown[]).length === cfg.points!.tiers!.length);

  const c = compactAlmResult(full);
  assert.ok(c.alm.rows.every((r) => r.events.length === 0));
  assert.equal(c.alm.customerOptions.length, 0);
  assert.deepEqual(c.analysis.monteCarlo?.samples ?? [], []);
  assert.equal(c.alm.rows.length, full.alm.rows.length);
  assert.deepEqual(c.alm.kpis, full.alm.kpis);
  // compact form must be far smaller than the full result
  assert.ok(JSON.stringify(c).length < JSON.stringify(full).length * 0.7);
  // the original is not mutated
  assert.ok(full.alm.customerOptions.length > 0);
});

test("inverse designer honours the liquidity objective and hole cap", () => {
  const cfg = templateConfig("negin_farapuya")!;
  const full = runFullAlmAnalysis({ product: cfg, marketShare: 2, horizon: 60, designer: { objective: "liquidity", maxHolePct: 3 } });
  const d = full.analysis.optimalTierDesign;
  assert.ok(d, "a design is proposed");
  const shares = d!.tiers.map((t) => t.expectedTakeUpShare);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 100) < 1.5);
  assert.ok(d!.kpis.maxHole <= full.alm.kpis.maxHole + 1e-9, "never worse than current on the liquidity objective");
});

test("customer all-in cost rises with the nominal rate and the waiting period", () => {
  const cost = (rate: number, wait: number) =>
    customerAllInCost(100, 100, wait, pmtFor("murabaha", 100, rate, 40), 40, 23, 0.01).cost;
  assert.ok(cost(20, 6) > cost(10, 6));
  assert.ok(cost(10, 9) > cost(10, 3));
  // with no wait and no deposit cost, all-in equals the loan's own effective rate (> nominal for murabaha)
  assert.ok(cost(18, 0) >= 18);
});
