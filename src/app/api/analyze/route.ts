import { apiFailure, readBody } from "@/lib/api";
import { getProduct, saveSimulation } from "@/db/repo";
import { runOptimizer, runSensitivity, runStress } from "@/lib/engine/analysis";
import { normalizeConfig } from "@/lib/engine/templates";
import type { Objective, ProductConfig } from "@/lib/engine/types";
import { sanitizeParams } from "@/lib/params";

export const dynamic = "force-dynamic";

const OBJECTIVES: Objective[] = ["profit", "raroc", "inclusion", "balanced"];

export async function POST(req: Request) {
  try {
    const body = (await readBody(req)) as {
      productId?: number;
      config?: unknown;
      params?: unknown;
      mode?: string;
      objective?: string;
    };
    const params = sanitizeParams(body.params);
    let cfg: ProductConfig;
    let productId: number | null = null;
    if (body.productId !== undefined) {
      const p = await getProduct(Number(body.productId));
      if (!p) return Response.json({ error: "محصول یافت نشد" }, { status: 404 });
      cfg = p.config;
      productId = p.id;
    } else {
      cfg = normalizeConfig(body.config);
    }

    if (body.mode === "stress") {
      const rows = runStress(cfg, params);
      if (productId) {
        const worst = rows.reduce((a, b) => (b.netProfit < a.netProfit ? b : a), rows[0]);
        await saveSimulation(productId, "stress", "all", { worst: worst.label, worstProfit: worst.netProfit, scenarios: rows.length }, rows);
      }
      return Response.json({ rows });
    }
    if (body.mode === "sensitivity") {
      const items = runSensitivity(cfg, params);
      if (productId) {
        await saveSimulation(productId, "sensitivity", params.scenario, { top: items[0]?.label ?? "", params: items.length }, items);
      }
      return Response.json({ items });
    }
    if (body.mode === "optimize") {
      const objective = (OBJECTIVES.includes(body.objective as Objective) ? body.objective : "balanced") as Objective;
      const result = runOptimizer(cfg, params, objective);
      if (productId) {
        await saveSimulation(
          productId,
          "optimize",
          params.scenario,
          { objective, evaluations: result.evaluations, changes: result.changes.length, baseProfit: result.baseline.kpis.netProfit, bestProfit: result.best.kpis.netProfit },
          result,
        );
      }
      return Response.json(result);
    }
    return Response.json({ error: "حالت تحلیل نامعتبر است" }, { status: 400 });
  } catch (e) {
    return apiFailure(e);
  }
}
