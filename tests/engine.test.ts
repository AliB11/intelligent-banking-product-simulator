import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSchedule, effectiveApr, mulberry32 } from "../src/lib/engine/math";
import { defaultConfig, mergeConfig, normalizeConfig, TEMPLATES, templateConfig } from "../src/lib/engine/templates";
import { resampleParams, runStress, runOptimizer } from "../src/lib/engine/analysis";
import { QUICK_PARAMS, simulatePortfolio } from "../src/lib/engine/simulator";
import { sanitizeParams } from "../src/lib/params";
import { apiFailure, productId, readBody } from "../src/lib/api";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("amortization conserves principal and cash flows for all repayment methods", () => {
  for (const method of ["annuity", "equal_principal", "step_up", "balloon", "bullet", "seasonal"] as const) {
    for (const tenor of [1, 2, 4, 5, 12, 25, 120]) for (const rate of [0, 4, 23]) {
      const s = buildSchedule(100, rate, tenor, 2, method, 15, 30);
      assert.equal(s.months, tenor + 2, `${method}/${tenor}`);
      near(s.bal.at(-1)!, 0);
      near(s.prin.reduce((a,b) => a+b, 0), 100);
      near(s.total, s.int.reduce((a,b) => a+b, 0) + 100);
      s.pay.forEach((v, i) => { assert.ok(Number.isFinite(v)); near(v, s.int[i] + s.prin[i]); });
    }
  }
});
test("APR matches compounded rate without fees and increases with fees", () => {
  const apr = effectiveApr(100, 24, 12, 0, "annuity", 0, 0, 0, 0, 0);
  near(apr, (1.02 ** 12 - 1) * 100);
  assert.ok(effectiveApr(100, 24, 12, 0, "annuity", 0, 0, 2, 0, 0) > apr);
});
test("normalization rejects invalid structures, enums, nonfinite and unbounded numbers", () => {
  const cfg = normalizeConfig({ kind: "constructor", color: "red", credit: { tenor: 1e9, rate: Infinity, minAmount: 9999, maxAmount: 5 }, risk: [], points: { transferable: "false" } });
  assert.equal(cfg.kind, "installment");
  assert.equal(cfg.credit.tenor, 360);
  assert.equal(cfg.credit.rate, 23);
  assert.equal(cfg.credit.minAmount, 5);
  assert.equal(cfg.risk.minScore, 560);
  assert.equal(cfg.points.transferable, false);
  assert.equal(normalizeConfig({ credit: "oops" }).credit.tenor, 24);
});
test("configuration merge cannot pollute prototypes", () => {
  const attack = JSON.parse('{"__proto__":{"polluted":true},"credit":{"__proto__":{"polluted":true}},"constructor":{"prototype":{"polluted":true}}}');
  mergeConfig(defaultConfig(), attack);
  normalizeConfig(attack);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
test("sample reduction preserves market size at every analysis cap", () => {
  for (const cap of [1200, 2500, 3000, 10000]) {
    const p = resampleParams({ ...QUICK_PARAMS, customers: 5000, scale: 200 }, cap);
    near(p.customers * p.scale, 1e6);
  }
  assert.equal(sanitizeParams({ scenario: "__proto__" }).scenario, "base");
  assert.equal(sanitizeParams({ scenario: "constructor" }).scenario, "base");
});
test("seeded simulations are deterministic and all template KPIs are finite", () => {
  const p = { ...QUICK_PARAMS, customers: 100, runs: 2, horizon: 12, scale: 10000 };
  assert.deepEqual(simulatePortfolio(defaultConfig(), p).kpis, simulatePortfolio(defaultConfig(), p).kpis);
  for (const t of TEMPLATES) {
    const cfg = templateConfig(t.key)!;
    assert.deepEqual(normalizeConfig(cfg), cfg, t.key);
    const sim = simulatePortfolio(cfg, p);
    for (const [key, value] of Object.entries(sim.kpis)) assert.ok(Number.isFinite(value), `${t.key}/${key}`);
    assert.equal(sim.series.length, p.horizon);
  }
  const a = mulberry32(42), b = mulberry32(42);
  assert.deepEqual(Array.from({length: 10}, a), Array.from({length: 10}, b));
});
test("stress scenarios retain a common market and produce finite results", () => {
  const rows = runStress(defaultConfig(), { ...QUICK_PARAMS, customers: 100, runs: 1, horizon: 12 });
  assert.equal(rows.length, 7);
  assert.ok(rows.every(r => Number.isFinite(r.netProfit)));
});
test("API rejects malformed, absent, oversized payloads and invalid identifiers", async () => {
  const req = (body: string) => new Request("http://test/api", { method: "POST", body });
  for (const body of ["{", "null", "[]", "{}", '{"config":false}', '{"productId":0}']) await assert.rejects(readBody(req(body)));
  await assert.rejects(readBody(req(JSON.stringify({config: {}, extra: "a".repeat(66000)}))), /حجم/);
  assert.deepEqual(await readBody(req('{"config":{}}')), {config: {}});
  for (const id of [0, -1, 1.2, "1e2", "abc", 2147483648, null]) assert.throws(() => productId(id));
  assert.equal(productId("42"), 42);
});
test("API errors do not leak infrastructure details", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const response = apiFailure(new Error("postgres://secret"));
    assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes("secret"));
  } finally { console.error = original; }
});

test("optimizer summary scores match the final reported KPIs", () => {
  const result = runOptimizer(defaultConfig(), { ...QUICK_PARAMS, customers: 200, runs: 1, horizon: 12 }, "profit");
  near(result.baseline.score, result.baseline.kpis.netProfit);
  near(result.best.score, result.best.kpis.netProfit);
});
