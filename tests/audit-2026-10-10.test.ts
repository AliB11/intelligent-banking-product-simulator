// Regression tests for the 2026-10-10 audit (see docs/AUDIT-2026-10-10.md).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANTI_NEGIN_DEPOSIT_SHARE,
  calcAntiNegin,
  customerAllInCost,
  pmtMurabaha,
  RATIO_CAP,
  runFullAlmAnalysis,
  simulateAlm,
  splitSchedule,
  type AlmSimInput,
} from "../src/lib/engine/alm";
import { checkCompliance } from "../src/lib/engine/advisor";
import { runOptimizer } from "../src/lib/engine/analysis";
import { aprFor, irbRetailK } from "../src/lib/engine/math";
import { chooseTier, DEFAULT_PARAMS, simulatePortfolio } from "../src/lib/engine/simulator";
import { MAX_TIERS, normalizeConfig, templateConfig } from "../src/lib/engine/templates";
import type { ProductConfig } from "../src/lib/engine/types";

const negin = (): ProductConfig => templateConfig("negin_farapuya")!;
const almInput = (cfg: ProductConfig, over: Partial<AlmSimInput> = {}): AlmSimInput => ({
  cfg,
  totalDepositBillionToman: 100,
  avgTicketMillionToman: 100,
  horizonMonths: 72,
  takeUpRatePct: 72,
  approvalRatePct: 85,
  runoffRatePct: 85,
  churnRatePct: 40,
  interbankRatePct: 24,
  opportunityRatePct: 23,
  reserveRatioPct: 10,
  withOptions: false,
  ...over,
});
const close = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} ≉ ${b}`);

// ---------- ALM cash-flow identities ----------

test("ALM: cumulative cash equals the sum of monthly net cash flows (no double counting)", () => {
  const r = simulateAlm(almInput(negin()));
  let s = 0;
  for (const row of r.rows) {
    close(row.ncf, row.inflow - row.outflow, 1e-9, `ncf month ${row.t}`);
    s += row.ncf;
    close(row.cum, s, 1e-9, `cum month ${row.t}`);
  }
  close(r.kpis.endCum, s, 1e-9);
});

test("ALM: α of every tier is a percentage of the deposit and respects the individual cap", () => {
  const cfg = negin();
  const r = simulateAlm(almInput(cfg));
  const capPctOfTicket = (cfg.points.individualLoanCap / 100) * 100; // 400M on a 100M ticket = 400%
  r.tiers.forEach((t, i) => {
    assert.equal(t.alphaEff, Math.min(cfg.points.tiers[i].loanToAvgDepositPct, capPctOfTicket));
    assert.ok(t.alphaEff >= 25 && t.alphaEff <= 200, `tier ${i} α=${t.alphaEff}`);
  });
  // the commitment must not be equal to the interest income any more (old interest/principal swap)
  assert.ok(r.kpis.totalIncomeInHorizon < r.kpis.totalCommitment * 0.5);
});

test("ALM: murabaha schedule splits instalments into principal and profit correctly", () => {
  const s = splitSchedule("murabaha", 100, 18, 24);
  close(s.pmt, pmtMurabaha(100, 18, 24), 1e-12);
  close(s.prin.reduce((a, b) => a + b, 0), 100, 1e-9, "principal repaid");
  assert.ok(s.inc[0] > s.inc[23], "profit share declines over time");
  close(s.inc[0], 100 * 0.015, 1e-12, "first profit = balance × r/12");
  const q = splitSchedule("qard", 120, 4, 12);
  close(q.inc.reduce((a, b) => a + b, 0), 120 * 0.04, 1e-9, "flat qard fee");
});

test("ALM: deposit balance falls when the tiers' waiting periods end", () => {
  const r = simulateAlm(almInput(negin()));
  const firstWait = Math.min(...negin().points.tiers.map((t) => t.waitingMonths));
  assert.equal(r.rows[firstWait - 1].depositBalance, r.rows[0].depositBalance);
  assert.ok(r.rows[firstWait].depositBalance < r.rows[0].depositBalance, "withdrawals must reduce the balance");
  assert.ok(r.rows[firstWait].withdrawalOut > 0);
  assert.ok(r.rows[firstWait].loanOut > 0);
  assert.ok(r.rows.at(-1)!.depositBalance < r.rows[0].depositBalance * 0.5);
});

test("ALM: a liquidity hole appears in the base case and is financed at the interbank rate", () => {
  const r = simulateAlm(almInput(negin()));
  assert.ok(r.kpis.maxHole > 0, "Negin creates a structural liquidity gap around month 12");
  assert.ok(r.kpis.interbankCost > 0);
  assert.ok(r.kpis.tippingPoint !== null && r.kpis.recoveryMonth !== null && r.kpis.recoveryMonth > r.kpis.tippingPoint);
  assert.ok(r.kpis.surplusIncome > 0, "surplus cash is reinvested at FTP in the P&L");
  close(r.kpis.netMargin, r.kpis.netInterestIncome + r.kpis.surplusIncome - r.kpis.interbankCost - r.kpis.totalProvision, 1e-9);
  assert.ok(Number.isFinite(r.kpis.minLcr) && r.kpis.minLcr <= RATIO_CAP);
  assert.ok(JSON.parse(JSON.stringify(r.kpis)).nsfrAt12 !== null, "ratios must be JSON-safe (no Infinity)");
});

test("ALM: customer all-in cost equals the contract rate when there is no opportunity cost", () => {
  const L = 100;
  const n = 36;
  const pmt = pmtMurabaha(L, 18, n);
  const { cost, opportunityCost } = customerAllInCost(L, 100, 6, pmt, n, 0, 0);
  assert.equal(opportunityCost, 0);
  close(cost, (Math.pow(1 + 0.015, 12) - 1) * 100, 1e-4, "effective annual rate of 18% nominal");
  const withOc = customerAllInCost(L, 100, 6, pmt, n, 23, 0);
  assert.ok(withOc.cost > cost, "waiting has a real cost for the customer");
});

test("ALM: anti-Negin applies the same deposit run-off as Negin borrowers", () => {
  const cfg = negin();
  const r = simulateAlm(almInput(cfg));
  const keep = calcAntiNegin(cfg, r, 10, 40, 0)!;
  const run = calcAntiNegin(cfg, r, 10, 40, 85)!;
  close(keep.fastLoanVolume, r.kpis.totalDeposit * ANTI_NEGIN_DEPOSIT_SHARE * (cfg.antiNegin!.fastLoanAlphaPct / 100), 1e-9);
  assert.ok(run.cashAtTrough! < keep.cashAtTrough!, "run-off reduces the liquidity contribution");
  assert.ok(run.holeCoverageByFastLoans < 100);
});

test("ALM: full analysis keeps unit consistency (market share of a 50,000 billion market)", () => {
  const f = runFullAlmAnalysis({ product: negin(), marketShare: 1, horizon: 36 });
  close(f.alm.kpis.totalDeposit, 500, 1e-9);
  assert.equal(f.analysis.stressGrid.length, 25);
  const mc1 = runFullAlmAnalysis({ product: negin(), marketShare: 1, horizon: 36, seed: 7 }).analysis.monteCarlo;
  const mc2 = runFullAlmAnalysis({ product: negin(), marketShare: 1, horizon: 36, seed: 7 }).analysis.monteCarlo;
  assert.deepEqual(mc1, mc2, "Monte Carlo must be reproducible for a given seed");
});

// ---------- core simulator: tiered points products ----------

test("core: tiered Negin earns contract interest (it used to be priced at the 0% qard fee)", () => {
  const cfg = negin();
  const sim = simulatePortfolio(cfg, { ...DEFAULT_PARAMS, customers: 3000, runs: 2 });
  assert.ok(sim.kpis.interestIncome > 0, "murabaha tiers must generate profit income");
  assert.ok(sim.kpis.apr > 5 && sim.kpis.apr < 30, `APR ${sim.kpis.apr}`);
  const rates = cfg.points.tiers.map((t) => t.rate);
  assert.ok(sim.pricing.productRate >= Math.min(...rates) && sim.pricing.productRate <= Math.max(...rates));
  assert.equal(sim.pricing.cap, 23, "an exchange contract is capped at 23%, not at the 4% qard fee");
  assert.ok(aprFor(cfg) > 10);
});

test("core: tier choice follows take-up shares and penalises tiers beyond the customer's patience", () => {
  const tiers = negin().points.tiers;
  const pick = (patience: number) => {
    const n = Array(tiers.length).fill(0);
    for (let i = 0; i < 2000; i++) n[chooseTier(tiers, (i + 0.5) / 2000, patience)]++;
    return n;
  };
  const patient = pick(24);
  const impatient = pick(2);
  assert.ok(patient.every((x) => x > 0));
  assert.ok(impatient[0] > patient[0], "impatient customers prefer the short-wait tier");
});

test("core: capital charge is grossed up for tax (after-tax ROE hurdle)", () => {
  const cfg = templateConfig("micro_instant")!;
  const sim = simulatePortfolio(cfg, { ...DEFAULT_PARAMS, customers: 2000, runs: 2 });
  const zeroTax = simulatePortfolio({ ...cfg, funding: { ...cfg.funding, taxRate: 0 } }, { ...DEFAULT_PARAMS, customers: 2000, runs: 2 });
  close(sim.pricing.capital / zeroTax.pricing.capital, 1 / (1 - cfg.funding.taxRate / 100), 0.02, "capital ratio");
  assert.ok(irbRetailK(0.05, 0.45) > 0);
});

test("core: optimizer never recommends a design worse than the current one", () => {
  const cfg = templateConfig("micro_instant")!;
  const r = runOptimizer(cfg, { ...DEFAULT_PARAMS, customers: 1500, runs: 2 }, "profit");
  assert.ok(r.best.score >= r.baseline.score - 1e-9, `best ${r.best.score} < baseline ${r.baseline.score}`);
});

// ---------- input boundary ----------

test("normalize: tiers are whitelisted, bounded and capped in count", () => {
  const evil = {
    ...negin(),
    points: {
      ...negin().points,
      tiers: [
        ...Array.from({ length: 40 }, (_, i) => ({ name: `t${i}`, waitingMonths: 1e9, repaymentMonths: -5, loanToAvgDepositPct: Number.NaN, rate: 500, minAvgDeposit: -1, expectedTakeUpShare: 10, id: 7, extra: "x".repeat(10) })),
      ],
    },
  };
  const n = normalizeConfig(evil);
  assert.equal(n.points.tiers.length, MAX_TIERS);
  const t = n.points.tiers[0] as unknown as Record<string, unknown>;
  assert.equal(t.waitingMonths, 60);
  assert.equal(t.repaymentMonths, 1);
  assert.equal(t.loanToAvgDepositPct, 25);
  assert.equal(t.rate, 100);
  assert.equal(t.minAvgDeposit, 0);
  assert.equal("extra" in t, false);
  assert.equal("id" in t, false);
  assert.deepEqual(normalizeConfig({ ...negin(), points: { ...negin().points, tiers: [null, 3, "x"] } }).points.tiers, []);
  assert.deepEqual(normalizeConfig(negin()), negin(), "templates survive normalisation unchanged");
});

test("normalize: percentage inputs are physically bounded", () => {
  const n = normalizeConfig({ ...negin(), credit: { ...negin().credit, rate: 1e6, upfrontFee: -3 }, funding: { ...negin().funding, taxRate: 400 } });
  assert.equal(n.credit.rate, 100);
  assert.equal(n.credit.upfrontFee, 0);
  assert.equal(n.funding.taxRate, 90);
});

test("advisor: tiered murabaha points are checked against the 23% cap, not the qard rules", () => {
  const cfg = negin();
  const items = checkCompliance(cfg).items;
  assert.equal(items.find((i) => i.id === "pts_rate")?.level, "pass");
  assert.equal(items.find((i) => i.id === "pts_contract")?.level, "info");
  assert.equal(items.some((i) => i.id === "pts_deprate" || i.id === "pts_fee"), false);
  const over = { ...cfg, points: { ...cfg.points, tiers: cfg.points.tiers.map((t, i) => (i === 0 ? { ...t, rate: 25 } : t)) } };
  assert.equal(checkCompliance(over).items.find((i) => i.id === "pts_rate")?.level, "fail");
});
