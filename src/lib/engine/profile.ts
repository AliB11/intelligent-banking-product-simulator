import { CBI, CONTRACTS, KINDS, PURPOSES } from "./catalog";
import type { Contract, Family, Kind, ProductConfig, Purpose } from "./types";

// ===== Structural coherence of a product (family ⇄ kind ⇄ contract ⇄ purpose ⇄ rate) =====
// Every transition that changes family, kind or contract goes through `reconcileStructure`.
// Only incompatibilities created by the transition are repaired; ordinary numeric inputs
// that the user set explicitly are left untouched, so regulatory limits still reach the advisor.

/** Contracts that a product kind can legally and operationally use. */
export const KIND_CONTRACTS: Record<Kind, Contract[]> = {
  installment: ["qard", "murabaha", "installment_sale", "ijara", "joaleh", "istisna"],
  credit_card: ["murabaha"],
  bnpl: ["murabaha", "installment_sale"],
  credit_line: ["musharaka", "mudaraba", "salaf", "murabaha"],
  points_loan: ["qard"],
  loyalty: ["qard"],
};

/** Contract used when a kind has to switch to a contract it does not support. */
export const DEFAULT_CONTRACT_BY_KIND: Record<Kind, Contract> = {
  installment: "murabaha",
  credit_card: "murabaha",
  bnpl: "murabaha",
  credit_line: "musharaka",
  points_loan: "qard",
  loyalty: "qard",
};

const faDigits = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

/** Profit rate (%) assigned when a qard-level fee becomes a sale/partnership rate. Inside the optimizer band 14–23%. */
export const DEFAULT_PROFIT_RATE = 20;

/** Kinds whose pricing is a credit rate (installment/card/BNPL/line). Points and loyalty use their own engines. */
export function isCreditKind(kind: Kind): boolean {
  return kind !== "points_loan" && kind !== "loyalty";
}

/** Kind to use when a contract is selected. Keeps the current kind when it already supports the contract. */
export function kindForContract(current: Kind, contract: Contract): Kind {
  if (KIND_CONTRACTS[current].includes(contract)) return current;
  const candidates: Kind[] = ["installment", "credit_line"];
  return candidates.find((k) => KIND_CONTRACTS[k].includes(contract)) ?? "installment";
}

/** Family that matches a kind, preferring the current family when the kind allows it. */
function familyFor(kind: Kind, current: Family): Family {
  const allowed = KINDS[kind].family;
  return allowed.includes(current) ? current : allowed[0];
}

export interface StructuralChange {
  cfg: ProductConfig;
  /** Persian messages describing every automatic repair; empty when nothing had to change. */
  notes: string[];
}

/**
 * Repairs the configuration after a structural transition from `prev` to `next`.
 * `next` is the user's intended change (kind/family/contract already set); this function
 * makes the remaining fields consistent with it.
 */
export function reconcileStructure(prev: ProductConfig, next: ProductConfig): StructuralChange {
  const notes: string[] = [];
  const cfg: ProductConfig = { ...next, credit: { ...next.credit }, points: { ...next.points } };

  // 1. family must be one that the kind belongs to
  cfg.family = familyFor(cfg.kind, cfg.family);

  // 2. contract must be supported by the kind
  if (!KIND_CONTRACTS[cfg.kind].includes(cfg.contract)) {
    const contract = DEFAULT_CONTRACT_BY_KIND[cfg.kind];
    notes.push(`عقد به «${CONTRACTS[contract].label}» تنظیم شد، چون «${KINDS[cfg.kind].label}» با «${CONTRACTS[cfg.contract].label}» سازگار نیست.`);
    cfg.contract = contract;
  }

  // 3. purpose must be allowed by the contract (Sharia fit)
  if (!CONTRACTS[cfg.contract].purposes.includes(cfg.purpose)) {
    const purpose: Purpose = CONTRACTS[cfg.contract].purposes[0];
    notes.push(`موضوع از «${PURPOSES[prev.purpose]}» به «${PURPOSES[purpose]}» تغییر کرد، چون «${CONTRACTS[cfg.contract].label}» برای آن مناسب نیست.`);
    cfg.purpose = purpose;
  }

  // 4. credit rate must be in the domain of the contract (qard = fee ≤ 4%, others = profit rate)
  const transitioned = prev.contract !== cfg.contract || prev.kind !== cfg.kind;
  if (transitioned && isCreditKind(cfg.kind)) {
    if (cfg.contract === "qard" && cfg.credit.rate > CBI.qardFeeCap) {
      notes.push(`کارمزد به سقف ${faDigits(CBI.qardFeeCap)}٪ قرض‌الحسنه محدود شد.`);
      cfg.credit.rate = CBI.qardFeeCap;
    } else if (cfg.contract !== "qard" && cfg.credit.rate <= CBI.qardFeeCap) {
      notes.push(`نرخ به ${faDigits(DEFAULT_PROFIT_RATE)}٪ تنظیم شد؛ نرخ ${faDigits(CBI.qardFeeCap)}٪ و کمتر مربوط به کارمزد قرض‌الحسنه است.`);
      cfg.credit.rate = DEFAULT_PROFIT_RATE;
    }
  }

  // 5. credit card tenor window (CBI) when the product becomes a card
  if (cfg.kind === "credit_card" && prev.kind !== "credit_card") {
    const tenor = Math.min(CBI.cardTenorMax, Math.max(CBI.cardTenorMin, cfg.credit.tenor));
    if (tenor !== cfg.credit.tenor) notes.push(`دوره کارت به بازه مجاز ${faDigits(CBI.cardTenorMin)} تا ${faDigits(CBI.cardTenorMax)} ماه محدود شد.`);
    cfg.credit.tenor = tenor;
  }

  return { cfg, notes };
}

/** Changes the product family, keeping the kind when possible. */
export function changeFamilyConfig(prev: ProductConfig, family: Family): StructuralChange {
  let kind: Kind = prev.kind;
  if (family === "points") kind = prev.kind === "loyalty" ? "loyalty" : "points_loan";
  else if (prev.kind === "points_loan" || prev.kind === "loyalty") kind = family === "hybrid" ? "credit_card" : "installment";
  return reconcileStructure(prev, { ...prev, family, kind });
}

/** Changes the product kind. The contract is kept when the new kind supports it. */
export function changeKindConfig(prev: ProductConfig, kind: Kind): StructuralChange {
  return reconcileStructure(prev, { ...prev, kind, family: familyFor(kind, prev.family) });
}

/** Changes the Sharia contract. The product kind follows the contract when the current kind cannot use it. */
export function changeContractConfig(prev: ProductConfig, contract: Contract): StructuralChange {
  const kind = kindForContract(prev.kind, contract);
  const next: ProductConfig = { ...prev, contract, kind, family: familyFor(kind, prev.family) };
  const change = reconcileStructure(prev, next);
  if (kind !== prev.kind) {
    change.notes.unshift(`نوع محصول به «${KINDS[kind].label}» تغییر کرد، چون «${CONTRACTS[contract].label}» با «${KINDS[prev.kind].label}» سازگار نیست.`);
  }
  return change;
}
