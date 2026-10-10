import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, readBody } from "../src/lib/api";
import { analyzeResult, checkCompliance, executiveSummary } from "../src/lib/engine/advisor";
import {
  almBaseInput, customerAllInCost, effectiveTiers, enumerateWaitAllocations,
  generateNeginOptions, pmtMurabaha, roundShares, simulateAlm, summarizeAlm, runFullAlmAnalysis,
} from "../src/lib/engine/alm";
import { runOptimizer, runSensitivity, runStress } from "../src/lib/engine/analysis";
import { buildSchedule, effectiveApr, irr, mulberry32, pointsLoanLimit } from "../src/lib/engine/math";
import { PERSONAS, personaToCustomer } from "../src/lib/engine/population";
import { DEFAULT_PARAMS, marketContext, QUICK_PARAMS, simulatePortfolio, underwrite } from "../src/lib/engine/simulator";
import { defaultConfig, mergeConfig, normalizeConfig, TEMPLATES, templateConfig } from "../src/lib/engine/templates";
import { sanitizeParams } from "../src/lib/params";

const close = (a: number, b: number, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const negin = () => templateConfig("negin_farapuya")!;
const small = { ...QUICK_PARAMS, customers: 600, runs: 1, horizon: 24 };
const assertFiniteTree = (value: unknown, path = "root") => {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`);
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${path}.${key}`);
  }
};

// Numerical stability and accounting identities, not just plausible-looking KPIs.
test("near-zero positive rates converge to the zero-rate schedule without NaN/Infinity", () => {
  for (const rate of [0, 1e-20, 1e-12, 1e-8]) {
    for (const method of ["annuity", "balloon", "step_up", "seasonal", "bullet", "equal_principal"] as const) {
      const s = buildSchedule(100, rate, 24, 0, method, 0, 30);
      assertFiniteTree(s, `${method}/${rate}`);
      close(s.prin.reduce((a, b) => a + b, 0), 100);
      close(s.total, 100, 1e-6);
    }
    close(pmtMurabaha(100, rate, 24), 100 / 24, 1e-8);
    close(effectiveApr(100, rate, 24, 0, "annuity", 0, 0, 0, 0, 0), 0, 1e-6);
  }
});

test("IRR expands its bracket instead of misreporting an expensive contract as zero", () => {
  close(irr([1, -3]), 2);
  close(irr([-1, 3]), 2);
  close(irr([100, -50]), -0.5);
  assert.ok(effectiveApr(100, 23, 24, 0, "annuity", 0, 0, 99.99, 0, 0) >= 999);
  assert.ok(effectiveApr(100, 23, 24, 0, "annuity", 0, 0, 100, 0, 0) >= 999);
});

test("largest-remainder rounding allocates exactly 100 percent for any non-empty menu", () => {
  const rng = mulberry32(91);
  for (let n = 1; n <= 12; n++) {
    for (let i = 0; i < 30; i++) {
      const weights = Array.from({ length: n }, () => i === 0 ? 1 : rng() * 100);
      const rounded = roundShares(weights);
      assert.equal(rounded.reduce((a, b) => a + b, 0), 100, `${n}: ${rounded}`);
      assert.ok(rounded.every((s) => Number.isInteger(s) && s >= 0));
    }
  }
});

test("simple ALM tiers implement L = k × B × H / N, not L = k × B", () => {
  for (const key of ["resalat_points", "nikvam_points"]) {
    const cfg = templateConfig(key)!;
    const tier = effectiveTiers(cfg)[0];
    close(tier.loanToAvgDepositPct, pointsLoanLimit(100, tier.waitingMonths, cfg.credit.tenor, cfg.points.coefficient));
    const res = simulateAlm({ ...almBaseInput({ product: cfg, marketShare: 1, horizon: 36 }), withOptions: false });
    close(res.tiers[0].alphaEff, tier.loanToAvgDepositPct);
    assert.equal(res.customerOptions.length, 0);
    assert.deepEqual(generateNeginOptions(100, cfg), [], "a simple product must not invent a 23% tiered menu");
  }
});

test("ALM observes all product loan caps and deposit/loan eligibility thresholds", () => {
  const cfg = mergeConfig(negin(), { credit: { maxAmount: 20 }, points: { maxLoan: 30, individualLoanCap: 40 } });
  const inp = almBaseInput({ product: cfg, marketShare: 1, horizon: 60 });
  const r = simulateAlm({ ...inp, withOptions: false });
  assert.ok(r.tiers.every((t) => t.alphaEff <= 20), "credit.maxAmount is the binding cap");
  const notEligible = simulateAlm({ ...inp, cfg: mergeConfig(cfg, { points: { minOpeningDeposit: 101 } }), withOptions: false });
  assert.equal(notEligible.kpis.totalCommitment, 0, "100M ticket does not meet 101M opening minimum");
  assert.ok(generateNeginOptions(100, cfg).every((o) => o.loanAmount <= 20));
});

test("ALM credit provision grows with contractual lifetime, not just annual PD", () => {
  const cfg = negin();
  const tier = { ...cfg.points.tiers[0], expectedTakeUpShare: 100 };
  const run = (months: number) => simulateAlm({
    ...almBaseInput({ product: cfg, marketShare: 1, horizon: 72 }),
    cfg: mergeConfig(cfg, { points: { tiers: [{ ...tier, repaymentMonths: months }] } }), withOptions: false,
  });
  const short = run(12), long = run(60);
  close(short.kpis.totalCommitment, long.kpis.totalCommitment);
  assert.ok(long.kpis.totalProvision > short.kpis.totalProvision * 3);
});

test("ALM charges upfront fees and includes fees/insurance in the customer all-in cost", () => {
  const cfg = negin();
  const run = (fee: number, insurance: number) => simulateAlm({
    ...almBaseInput({ product: cfg, marketShare: 1, horizon: 72 }),
    cfg: mergeConfig(cfg, { credit: { upfrontFee: fee, insurance } }), withOptions: false,
  });
  const free = run(0, 0), charged = run(2, 1);
  assert.ok(charged.tiers[0].customerIrr > free.tiers[0].customerIrr);
  assert.ok(charged.kpis.netMargin > free.kpis.netMargin);
  close(customerAllInCost(100, 100, 0, pmtMurabaha(100, 18, 36), 36, 0, 0).cost, (1.015 ** 12 - 1) * 100, 1e-6);
});

test("turning off combined benefits excludes mixed wait allocations", () => {
  const cfg = mergeConfig(negin(), { points: { allowCombinedBenefits: false } });
  const allocations = enumerateWaitAllocations(3, cfg);
  assert.ok(allocations.length > 0);
  assert.ok(allocations.every((a) => Object.values(a).filter((v) => v > 0).length <= 1));
});

test("tiered sensitivity perturbs actual tier rates and alpha rather than dead fee/coefficient knobs", () => {
  const rows = runSensitivity(negin(), small);
  assert.ok(rows.find((r) => r.key === "rate")!.swing > 0);
  assert.ok(rows.find((r) => r.key === "alpha")!.swing > 0);
  assert.ok(!rows.some((r) => r.key === "coef"));
  assert.match(rows.find((r) => r.key === "rate")!.label, /سود/);
});

test("underwriting cannot grant a zero-alpha tier or ignore the minimum opening balance", () => {
  const customer = personaToCustomer({ ...PERSONAS[0], income: 1000, balance: 500 });
  const cfg = negin();
  const zero = mergeConfig(cfg, { points: { tiers: [{ ...cfg.points.tiers[0], loanToAvgDepositPct: 0, expectedTakeUpShare: 100 }] } });
  assert.equal(underwrite(zero, customer, marketContext(zero, 26), 20).eligible, false);
  const opening = mergeConfig(cfg, { points: { minOpeningDeposit: 1e6 } });
  assert.equal(underwrite(opening, customer, marketContext(opening, 26), 20).eligible, false);
});

test("DTI covers the largest scheduled payment for step-up, bullet and balloon loans", () => {
  const c = personaToCustomer({ ...PERSONAS[0], income: 30, existingDebt: 0 });
  for (const repayment of ["step_up", "balloon", "bullet"] as const) {
    const cfg = mergeConfig(defaultConfig(), { credit: { tenor: 36, repayment, stepUp: 60, balloon: 80, minAmount: 1 }, risk: { minScore: 0, maxDti: 40 } });
    const uw = underwrite(cfg, c, marketContext(cfg, 26), 300);
    assert.ok(uw.eligible);
    const s = buildSchedule(uw.financed, uw.rate, uw.tenor, cfg.credit.grace, repayment, 60, 80);
    assert.ok(Math.max(...s.pay) / c.income * 100 <= cfg.risk.maxDti + 1e-8, `${repayment} approved an unaffordable future instalment`);
  }
});

test("a tiered murabaha menu cannot bypass qard fee compliance with a hidden 23% tier", () => {
  const cfg = mergeConfig(negin(), { contract: "qard", points: { loanFee: 4, depositRate: 0 } });
  const items = checkCompliance(cfg).items;
  assert.ok(items.some((i) => i.level === "fail"), "structurally contradictory and over-cap menu must fail");
  assert.equal(items.find((i) => i.id === "pts_fee")?.level, "fail");
});

test("public JSON endpoints reject cross-origin, non-JSON and ambiguous sources", async () => {
  const req = (headers: Record<string, string>, body = '{"config":{}}') => new Request("https://bank.example/api/simulate", { method: "POST", headers, body });
  const rejected = (status: number) => (e: unknown) => e instanceof ApiError && e.status === status;
  await assert.rejects(readBody(req({ "Content-Type": "text/plain" })), rejected(415));
  await assert.rejects(readBody(req({ "Content-Type": "application/json", Origin: "https://evil.example" })), rejected(403));
  await assert.rejects(readBody(req({ "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" })), rejected(403));
  await assert.rejects(readBody(req({ "Content-Type": "application/json" }, '{"config":{},"productId":1}')), rejected(400));
  assert.deepEqual(await readBody(req({ "Content-Type": "application/json", Origin: "https://bank.example" })), { config: {} });
  assert.deepEqual(await readBody(req({ "Content-Type": "application/json" })), { config: {} }, "CLI clients need no Origin header");
});

test("parameter sanitization does not coerce arrays, booleans or blank strings to valid numbers", () => {
  for (const input of [true, [700], {}, "   "]) {
    const p = sanitizeParams({ customers: input, runs: input, seed: input });
    assert.equal(p.customers, DEFAULT_PARAMS.customers);
    assert.equal(p.runs, DEFAULT_PARAMS.runs);
    assert.equal(p.seed, DEFAULT_PARAMS.seed);
  }
  assert.equal(sanitizeParams({ customers: "750" }).customers, 750);
});

test("all template simulations preserve P&L identities and finite values", () => {
  for (const t of TEMPLATES) {
    const cfg = templateConfig(t.key)!;
    const r = simulatePortfolio(cfg, { ...small, customers: 500, runs: 2 });
    assertFiniteTree(r, t.key);
    let cum = 0;
    for (const m of r.series) {
      close(m.profit, m.interest + m.fees + m.benefit + m.incremental - m.funding - m.opex - m.losses - m.reward);
      cum += m.profit;
      close(m.cumProfit, cum);
    }
    close(r.kpis.preTaxProfit, cum);
    close(r.profitDist.mean, r.kpis.netProfit);
    assert.ok(r.kpis.netProfit <= r.kpis.preTaxProfit + 1e-8);
    close(r.waterfall.reduce((s, row) => s + row.value, 0), r.kpis.netProfit);
  }
});

test("normalized adversarial configurations stay finite throughout the simulation", () => {
  for (const cfg of [
    normalizeConfig({ credit: { rate: 1e-20, repayment: "annuity" } }),
    normalizeConfig({ credit: { rate: 1e-20, repayment: "balloon", balloon: 90 } }),
    normalizeConfig({ credit: { upfrontFee: 100, insurance: 100, compensatingDeposit: 90 } }),
  ]) assertFiniteTree(simulatePortfolio(cfg, { ...small, customers: 500 }), cfg.code);
});

test("ALM history stores the seed and designer constraints for exact reproduction", () => {
  const cfg = negin();
  const params = { marketShare: 1, horizon: 24, seed: 73, designer: { objective: "liquidity" as const, maxHolePct: 7, minMarginPct: -5, maxLeverage: 3 } };
  const r = runFullAlmAnalysis({ product: cfg, ...params });
  const summary = summarizeAlm(r, params, cfg);
  assert.equal(summary.seed, params.seed);
  assert.deepEqual(summary.designer, params.designer);
});

test("ALM gross loan book conserves disbursements, cash principal and maturity write-offs", () => {
  for (const horizon of [24, 72]) {
    const r = simulateAlm({ ...almBaseInput({ product: negin(), marketShare: 1, horizon }), withOptions: false });
    let book = 0;
    for (const row of r.rows) {
      book += row.loanOut - row.principalIn - row.writeOff;
      close(row.loanBook, book, 1e-7);
      assert.ok(row.loanBook >= 0);
    }
    if (horizon === 72) close(book, 0, 1e-7);
  }
});

test("tier-level APR, demand and adverse-selection PD do not depend on other tiers' weights", () => {
  const cfg = negin();
  const tiers = [
    { ...cfg.points.tiers[0], rate: 23, expectedTakeUpShare: 50 },
    { ...cfg.points.tiers[0], rate: 0, expectedTakeUpShare: 50 },
  ];
  const a = mergeConfig(cfg, { points: { tiers } });
  const b = mergeConfig(a, { points: { tiers: tiers.map((t, i) => ({ ...t, expectedTakeUpShare: i === 0 ? 10 : 90 })) } });
  const customer = personaToCustomer({ ...PERSONAS[0], income: 1000, balance: 500 });
  customer.u[5] = 0;
  const ca = marketContext(a, 20), cb = marketContext(b, 20);
  assert.ok(Math.abs(ca.apr - cb.apr) > 5, "weighted menu APRs are genuinely different");
  const ua = underwrite(a, customer, ca, 20), ub = underwrite(b, customer, cb, 20);
  assert.equal(ua.tierIndex, 0); assert.equal(ub.tierIndex, 0);
  close(ua.apr, effectiveApr(100, 23, tiers[0].repaymentMonths, 0, "annuity", 0, 0, cfg.credit.upfrontFee, cfg.credit.insurance, 0));
  close(ua.apr, ub.apr); close(ua.applyProb, ub.applyProb); close(ua.pd, ub.pd);
});

test("insurance expense is included in affordability rather than APR alone", () => {
  const cfg = mergeConfig(defaultConfig(), { credit: { insurance: 24, tenor: 36, minAmount: 1 }, risk: { minScore: 0, maxDti: 40 } });
  const c = personaToCustomer({ ...PERSONAS[0], income: 30, existingDebt: 0 });
  const u = underwrite(cfg, c, marketContext(cfg, 26), 300);
  assert.ok(u.eligible && u.reducedByDti);
  const s = buildSchedule(u.financed, u.rate, u.tenor, 0, "annuity");
  assert.ok((Math.max(...s.pay) + u.financed * cfg.credit.insurance / 1200) / c.income * 100 <= 40 + 1e-8);
});

test("zero-wait tier means no artificial extra waiting month across core and menu generation", () => {
  const cfg = negin();
  const immediate = mergeConfig(cfg, {
    credit: { minAmount: 1 }, risk: { minScore: 0, maxDti: 100, maxAge: 100, collateral: "scoring" },
    points: { usageRate: 100, tiers: [{ ...cfg.points.tiers[0], waitingMonths: 0, expectedTakeUpShare: 100 }] },
  });
  const c = personaToCustomer({ ...PERSONAS[0], income: 1000, balance: 500 });
  assert.equal(underwrite(immediate, c, marketContext(immediate, 26), 20).holdMonths, 0);
  assert.ok(simulatePortfolio(immediate, small).series[0].interest > 0, "immediate loans exist in the first monthly bucket");
  assert.ok(generateNeginOptions(100, immediate).some((o) => o.waitingMonths === 0));
  assert.deepEqual(generateNeginOptions(100, mergeConfig(cfg, { contract: "qard" })), [], "contradictory contract cannot invent murabaha options");
});

test("inverse designer includes the current mix and cannot revive a zero-share tier", () => {
  const cfg = negin();
  cfg.points.tiers[0].expectedTakeUpShare = 0;
  const full = runFullAlmAnalysis({ product: cfg, marketShare: 1, horizon: 60, designer: { objective: "liquidity", maxHolePct: 100, minMarginPct: -100, maxLeverage: 20 } });
  const best = full.analysis.optimalTierDesign;
  assert.ok(best);
  assert.equal(best.tiers[0].expectedTakeUpShare, 0);
  assert.ok(best.kpis.maxHole <= full.alm.kpis.maxHole + 1e-7);
});

test("normalization validates every enum and removes duplicate tier identifiers", () => {
  for (const invalid of ["invalid", "constructor", "__proto__", "toString"]) {
    const cfg = normalizeConfig({ kind: invalid, contract: invalid, points: { mode: invalid }, credit: { repayment: invalid }, risk: { collateral: invalid } });
    assert.equal(cfg.kind, "installment"); assert.equal(cfg.points.mode, "simple");
    assert.equal(cfg.contract, "murabaha"); assert.equal(cfg.credit.repayment, "annuity"); assert.equal(cfg.risk.collateral, "e_promissory");
  }
  const tiers = negin().points.tiers.slice(0, 2).map((t) => ({ ...t, id: "reused" }));
  const clean = normalizeConfig(mergeConfig(negin(), { points: { tiers } }));
  assert.equal(clean.points.tiers[0].id, "reused"); assert.equal(clean.points.tiers[1].id, undefined);
});

test("API bounds UTF-8 bytes and accepts only matching trusted-proxy preview origins", async () => {
  const rejected = (status: number) => (e: unknown) => e instanceof ApiError && e.status === status;
  const oversized = JSON.stringify({ config: { description: "ب".repeat(40000) } });
  assert.ok(oversized.length < 65536 && Buffer.byteLength(oversized) > 65536);
  await assert.rejects(readBody(new Request("https://bank.example/api/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: oversized })), rejected(413));
  const proxy = (origin: string) => new Request("http://0.0.0.0:3000/api/simulate", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", "X-Forwarded-Host": "3000-audit.e2b.app", "X-Forwarded-Proto": "https", Origin: origin }, body: '{"config":{}}',
  });
  assert.deepEqual(await readBody(proxy("https://3000-audit.e2b.app")), { config: {} });
  for (const origin of ["null", "file:///tmp/x", "https://evil.example", "http://3000-audit.e2b.app", "https://3000-audit.e2b.app:444"]) {
    await assert.rejects(readBody(proxy(origin)), rejected(403));
  }
});

test("simple points underwriting never violates a minimum holding period beyond the twelve-month preference cap", () => {
  const c = personaToCustomer({ ...PERSONAS[0], income: 1000, balance: 500 });
  for (const minHoldingDays of [365, 730, 3650]) {
    const cfg = mergeConfig(templateConfig("resalat_points")!, { points: { minHoldingDays }, risk: { maxAge: 100 } });
    const uw = underwrite(cfg, c, marketContext(cfg, 26), 20);
    assert.ok(uw.holdMonths >= minHoldingDays / 30);
    assert.ok(uw.waitDays >= minHoldingDays);
  }
});


test("zero credit/capital bases produce null ratios instead of extreme epsilon returns", () => {
  const points = mergeConfig(templateConfig("resalat_points")!, { points: { usageRate: 0 } });
  const empty = mergeConfig(defaultConfig(), { risk: { maxAge: 18 } });
  for (const cfg of [points, empty]) {
    const r = simulatePortfolio(cfg, small);
    assert.equal(r.kpis.booked, 0);
    assert.equal(r.kpis.avgOutstanding, 0);
    assert.equal(r.kpis.economicCapital, 0);
    assert.equal(r.kpis.regulatoryCapital, 0);
    for (const key of ["raroc", "rarocCredit", "roa", "nim"] as const) {
      assert.equal(r.kpis[key], null, key);
      assert.equal(JSON.parse(JSON.stringify(r)).kpis[key], null, `${key} JSON`);
    }
    if (cfg.kind === "points_loan") {
      assert.ok(r.kpis.liquidityCapital > 0);
      assert.ok(r.kpis.rarocLiquidity !== null && Number.isFinite(r.kpis.rarocLiquidity));
    } else {
      assert.equal(r.kpis.rarocLiquidity, null);
    }
    assertFiniteTree(r);
  }
  const loyalty = simulatePortfolio(templateConfig("loyalty_club")!, small);
  for (const key of ["raroc", "rarocCredit", "rarocLiquidity", "roa", "nim"] as const) {
    assert.equal(loyalty.kpis[key], null, `loyalty/${key}`);
  }
});

test("undefined RAROC cannot inflate health, win the ratio objective, or become zero in narrative/stress", () => {
  const cfg = mergeConfig(templateConfig("resalat_points")!, { points: { usageRate: 0 } });
  const full = analyzeResult(cfg, simulatePortfolio(cfg, small));
  assert.equal(full.health.parts.find(p => p.key === "profit")!.value, 0);
  assert.ok(full.insights.some(i => i.id === "undefined_raroc" && i.level === "warning"));
  assert.ok(!full.insights.some(i => i.id === "value"));
  assert.match(executiveSummary(cfg, full).join(" "), /RAROC نامعین/);
  assert.ok(runStress(cfg, small).every(r => r.raroc === null));
  const opt = runOptimizer(cfg, small, "raroc");
  assert.equal(opt.baseline.score, -Number.MAX_SAFE_INTEGER);
  assert.equal(opt.baseline.feasible, false);
  assert.equal(opt.best.feasible, false);
  assert.deepEqual(opt.changes, []);
  assert.ok(opt.points.every(p => !p.feasible && Number.isFinite(p.score)));
  assertFiniteTree(opt);
});
