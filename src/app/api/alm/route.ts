import { ApiError, apiFailure, productId as parseProductId, readJsonObject } from "@/lib/api";
import { getProduct, saveSimulation } from "@/db/repo";
import { compactAlmResult, runFullAlmAnalysis, summarizeAlm, type AlmDesignerConstraints, type FullAlmParams } from "@/lib/engine/alm";
import { normalizeConfig, templateConfig } from "@/lib/engine/templates";
import type { ProductConfig } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlmScenario = NonNullable<FullAlmParams["scenario"]>;
const ALM_SCENARIOS: readonly AlmScenario[] = ["base", "stress", "fast_growth"];

const finite = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/**
 * Full ALM analysis of a tiered points product.
 * Body: one of `config` (or legacy `product`), `productId`, `templateKey`; optional `marketShare` (%),
 * `horizon` (months), `scenario`, `seed`, `opportunityRate` (%), `designer` constraints and `save`
 * (persist the run in the product history; only with `productId`, analysed on the stored configuration).
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonObject(req);
    let cfg: ProductConfig;
    let storedId: number | null = null;
    const raw = body.config ?? body.product;
    if (raw !== undefined) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError("پیکربندی نامعتبر است");
      cfg = normalizeConfig(raw);
    } else if (body.productId !== undefined) {
      const p = await getProduct(parseProductId(body.productId));
      if (!p) return Response.json({ error: "محصول یافت نشد" }, { status: 404 });
      cfg = p.config;
      storedId = p.id;
    } else if (typeof body.templateKey === "string") {
      const tpl = templateConfig(body.templateKey);
      if (!tpl) return Response.json({ error: "الگو یافت نشد" }, { status: 404 });
      cfg = tpl;
    } else {
      throw new ApiError("یکی از config، productId یا templateKey الزامی است");
    }
    if (cfg.kind !== "points_loan") throw new ApiError("تحلیل ALM فقط برای محصولات وام امتیازی تعریف شده است");

    const scenario = ALM_SCENARIOS.includes(body.scenario as AlmScenario) ? (body.scenario as AlmScenario) : "base";
    const d = body.designer && typeof body.designer === "object" && !Array.isArray(body.designer) ? (body.designer as Record<string, unknown>) : {};
    const designer: AlmDesignerConstraints = {
      maxHolePct: finite(d.maxHolePct, 40, 0, 100),
      minMarginPct: finite(d.minMarginPct, 2, -100, 200),
      maxLeverage: finite(d.maxLeverage, 2.5, 0.1, 20),
      objective: d.objective === "liquidity" || d.objective === "reach" ? d.objective : "margin",
    };
    const params: Omit<FullAlmParams, "product"> = {
      marketShare: finite(body.marketShare, 5, 0.1, 50),
      horizon: Math.round(finite(body.horizon, 60, 12, 120)),
      scenario,
      seed: Math.trunc(finite(body.seed, 1405, 1, 2 ** 31 - 1)),
      opportunityRatePct: finite(body.opportunityRate, 23, 0, 100),
      designer,
    };
    const result = runFullAlmAnalysis({ product: cfg, ...params });
    let simulationId: number | null = null;
    if (body.save === true && storedId !== null) {
      simulationId = await saveSimulation(storedId, "alm", scenario, summarizeAlm(result, params, cfg), compactAlmResult(result));
    }
    return Response.json({ ...result, simulationId });
  } catch (error) {
    return apiFailure(error);
  }
}
