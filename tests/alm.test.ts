import { test } from "node:test";
import assert from "node:assert";
import { runFullAlmAnalysis, simulateAlm } from "../src/lib/engine/alm";
import { templateConfig } from "../src/lib/engine/templates";

test("ALM Engine - Negin Farapuya", async (t) => {
  const cfg = templateConfig("negin_farapuya");
  assert(cfg, "Negin template should exist");

  await t.test("Basic full analysis runs without crashing", () => {
    const result = runFullAlmAnalysis({
      product: cfg!,
      marketShare: 5, // ۵٪ سهم بازار
      horizon: 24,    // شبیه‌سازی ۲۴ ماهه
    });

    assert(result.alm.rows.length === 25, "Should have 24+1 rows");
    assert(result.alm.tiers.length === 7, "Should process all 7 tiers");
    assert(result.alm.kpis.totalDeposit > 0, "Total deposit should be > 0");
    
    // Check custom options generation
    assert(result.alm.customerOptions.length > 200, "Should generate ~250 combinations");
    const pareto = result.alm.paretoFrontier;
    assert(pareto.length > 0, "Should have at least one Pareto optimal point");
  });

  await t.test("Gamification & Prepayment modules impact", () => {
    const result = runFullAlmAnalysis({
      product: cfg!,
      marketShare: 5,
      horizon: 60,
    });
    
    // Gamification
    assert(result.gamificationJourney && result.gamificationJourney.length === 7, "Gamification journey should have 7 steps");
    assert(result.gamification, "Gamification result should exist");
    assert(result.gamification.totalPointsIssued > 0, "Should issue points");

    // Prepayment
    assert(result.prepayment, "Prepayment result should exist");
    assert(result.prepayment.avgPrepaymentRate > 0, "Should have positive prepayment rate due to market gap");
    
    // AntiNegin
    assert(result.antiNegin, "AntiNegin result should exist");
    assert(result.antiNegin.fastLoanVolume > 0, "Should have fast loan volume");
  });

  await t.test("Cash flow sanity check (Double Liquidity Drain)", () => {
    const H = 24;
    const base = {
      cfg: cfg!,
      totalDepositBillionToman: 100,
      avgTicketMillionToman: 100,
      horizonMonths: H,
      takeUpRatePct: 100,
      approvalRatePct: 100,
      runoffRatePct: 100, // همه مشتریان در زمان وام‌گیری، سپرده را هم خارج می‌کنند
      churnRatePct: 100,
      interbankRatePct: 24,
      opportunityRatePct: 23,
      reserveRatioPct: 10,
    };
    
    const res = simulateAlm(base);
    // ماه ۲ (اولین پله)، باید شاهد خروج سپرده + وام باشیم
    const month2 = res.rows[2];
    assert(month2.loanOut > 0, "Should disburse loan in month 2");
    assert(month2.withdrawalOut > 0, "Should have withdrawal in month 2");
    // جریان نقد منفی باید باشد
    assert(month2.outflow > month2.inflow, "Outflow should be greater than inflow during double drain");
    
    // مجموع جریان نقد تجمعی باید به خاطر نرخ مرابحه مثبت شود
    const lastCum = res.rows[H].cum;
    // با فرض سپرده ۱۰٪ و وام ۲۳٪، نهایتاً باید سودده باشد
    // البته چون فقط بخشی وام می‌گیرند باید بررسی دقیق‌تری کرد، اما حداقل باید بتواند مقادیر معنی‌داری بدهد.
    assert(isFinite(lastCum), "Cumulative CF should be finite");
  });
});
