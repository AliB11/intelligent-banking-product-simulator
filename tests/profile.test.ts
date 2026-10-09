import assert from "node:assert/strict";
import { test } from "node:test";
import { CBI, CONTRACTS, KINDS, PURPOSES } from "../src/lib/engine/catalog";
import { checkCompliance } from "../src/lib/engine/advisor";
import {
  changeContractConfig,
  changeFamilyConfig,
  changeKindConfig,
  DEFAULT_PROFIT_RATE,
  isCreditKind,
  KIND_CONTRACTS,
  reconcileStructure,
} from "../src/lib/engine/profile";
import type { Contract, Kind, ProductConfig } from "../src/lib/engine/types";
import { defaultConfig, templateConfig } from "../src/lib/engine/templates";

const tpl = (key: string): ProductConfig => templateConfig(key)!;
// Structural incompatibilities only. Rate caps are checked separately because explicit user inputs are reported, not rewritten.
const structuralFails = (cfg: ProductConfig) =>
  checkCompliance(cfg).items.filter((i) => i.level === "fail" && /pts_|card_|sharia/.test(i.id)).map((i) => i.id);
const rateFails = (cfg: ProductConfig) =>
  checkCompliance(cfg).items.filter((i) => i.level === "fail" && /qard_fee|rate_cap/.test(i.id)).map((i) => i.id);

test("switching a qard points loan to murabaha moves the product to murabaha parameters", () => {
  const before = tpl("resalat_points");
  assert.equal(before.kind, "points_loan");

  const { cfg, notes } = changeContractConfig(before, "murabaha");

  assert.equal(cfg.contract, "murabaha");
  assert.equal(cfg.kind, "installment", "points engine (and its tab) must be replaced by a credit product");
  assert.equal(cfg.family, "credit");
  assert.ok(CONTRACTS.murabaha.purposes.includes(cfg.purpose), "purpose must be Sharia-compatible with murabaha");
  assert.equal(cfg.credit.rate, DEFAULT_PROFIT_RATE, "qard fee must not survive as the murabaha profit rate");
  assert.ok(notes.some((n) => n.includes("نوع محصول")), "user must be told the product type changed");
  assert.ok(notes.some((n) => n.includes("موضوع")), "cash purpose is not allowed for murabaha and must be reported");
  assert.deepEqual(structuralFails(cfg), []);
});

test("switching murabaha back to qard clamps the rate to the qard fee cap", () => {
  const { cfg } = changeContractConfig(tpl("micro_instant"), "qard");
  assert.equal(cfg.kind, "installment");
  assert.equal(cfg.contract, "qard");
  assert.ok(cfg.credit.rate <= CBI.qardFeeCap, `rate ${cfg.credit.rate} above qard cap`);
  assert.ok(CONTRACTS.qard.purposes.includes(cfg.purpose));
  assert.deepEqual(structuralFails(cfg), []);
});

test("changing a points product kind keeps a valid qard fee", () => {
  const withMurabahaRate = { ...tpl("micro_instant"), kind: "points_loan" as Kind, contract: "qard" as Contract, family: "points" as const };
  const { cfg } = changeKindConfig(withMurabahaRate, "installment");
  assert.equal(cfg.contract, "qard");
  assert.ok(cfg.credit.rate <= CBI.qardFeeCap);
  assert.deepEqual(structuralFails(cfg), []);
});

test("a credit card cannot keep a non-murabaha contract and its tenor is bounded", () => {
  const { cfg } = changeKindConfig({ ...defaultConfig(), contract: "ijara", purpose: "vehicle", credit: { ...defaultConfig().credit, tenor: 60 } }, "credit_card");
  assert.equal(cfg.contract, "murabaha");
  assert.ok(cfg.credit.tenor >= CBI.cardTenorMin && cfg.credit.tenor <= CBI.cardTenorMax);
  assert.deepEqual(structuralFails(cfg), []);
});

test("selecting a contract the kind cannot use moves the kind instead of keeping a contradiction", () => {
  const card = changeContractConfig(tpl("murabaha_card"), "ijara");
  assert.equal(card.cfg.kind, "installment");
  assert.equal(card.cfg.contract, "ijara");
  assert.ok(KIND_CONTRACTS[card.cfg.kind].includes(card.cfg.contract));

  const line = changeKindConfig(tpl("sme_line"), "installment");
  assert.equal(line.cfg.contract, "murabaha", "musharaka is not an installment contract");
  assert.ok(line.notes.length > 0);
});

test("family change from points to credit leaves no points-only fields in the kind", () => {
  const { cfg } = changeFamilyConfig(tpl("resalat_points"), "credit");
  assert.equal(cfg.kind, "installment");
  assert.equal(cfg.family, "credit");
  assert.equal(cfg.contract, "qard", "qard is valid for installment and remains selected");
});

test("ordinary edits that do not cross a contract boundary keep the user's inputs", () => {
  const base = { ...tpl("car_ijara"), contract: "murabaha" as Contract, purpose: "vehicle" as const };
  const { cfg, notes } = changeKindConfig({ ...base, credit: { ...base.credit, rate: 21 } }, "bnpl");
  assert.equal(cfg.kind, "bnpl");
  assert.equal(cfg.contract, "murabaha");
  assert.equal(cfg.credit.rate, 21);
  assert.deepEqual(notes, []);
});

test("no-op reconciliation returns the same values and no notes", () => {
  const cfg = tpl("murabaha_card");
  const out = reconcileStructure(cfg, cfg);
  assert.deepEqual(out.cfg, cfg);
  assert.deepEqual(out.notes, []);
});

test("every kind/contract/purpose combination reconciles to a structurally coherent product", () => {
  const base = defaultConfig();
  const kinds = Object.keys(KINDS) as Kind[];
  const contracts = Object.keys(CONTRACTS) as Contract[];
  for (const prevKind of kinds) for (const prevContract of contracts) for (const kind of kinds) for (const contract of contracts) {
    for (const rate of [0, 3, 23]) {
      const prev = { ...base, kind: prevKind, family: KINDS[prevKind].family[0], contract: prevContract, credit: { ...base.credit, rate } };
      const a = changeKindConfig(prev, kind).cfg;
      const b = changeContractConfig(prev, contract).cfg;
      for (const cfg of [a, b]) {
        const tag = `${prevKind}/${prevContract} -> ${cfg.kind}/${cfg.contract}`;
        assert.ok(KINDS[cfg.kind].family.includes(cfg.family), `${tag}: family`);
        assert.ok(KIND_CONTRACTS[cfg.kind].includes(cfg.contract), `${tag}: contract`);
        assert.ok(CONTRACTS[cfg.contract].purposes.includes(cfg.purpose), `${tag}: purpose ${PURPOSES[cfg.purpose]}`);
        assert.deepEqual(structuralFails(cfg), [], tag);
        // Crossing a contract/kind boundary must leave a rate in the domain of the new contract.
        if ((cfg.contract !== prevContract || cfg.kind !== prevKind) && isCreditKind(cfg.kind)) assert.deepEqual(rateFails(cfg), [], tag);
      }
    }
  }
});
