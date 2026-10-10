import { ApiError, apiFailure, readBody } from "@/lib/api";
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
    if (!["stress", "sensitivity", "optimize"].includes(body.mode ?? "")) throw new ApiError("حالت تحلیل نامعتبر است");
    const params = sanitizeParams(body.params);
    let cfg: ProductConfig;
    let productId: number | null = null;
    let configVersion: number | undefined;
    if (body.productId !== undefined) {
      const p = await getProduct(Number(body.productId));
      if (!p) return Response.json({ error: "محصول یافت نشد" }, { status: 404 });
      cfg = p.config;
      productId = p.id;
      configVersion = p.configVersion;
    } else {
      cfg = normalizeConfig(body.config);
    }

    if (body.mode === "stress") {
      const rows = runStress(cfg, params);
      if (productId) {
        const worst = rows.reduce((a, b) => (b.netProfit < a.netProfit ? b : a), rows[0]);
        await saveSimulation(productId, cfg, "stress", "all", { worst: worst.label, worstProfit: worst.netProfit, scenarios: rows.length, params }, rows, configVersion);
      }
      return Response.json({ rows, config: cfg, configVersion });
    }
    if (body.mode === "sensitivity") {
      const items = runSensitivity(cfg, params);
      if (productId) {
        await saveSimulation(productId, cfg, "sensitivity", params.scenario, { top: items[0]?.label ?? "", parameters: items.length, params }, items, configVersion);
      }
      return Response.json({ items, config: cfg, configVersion });
    }
    if (body.mode === "optimize") {
      const objective = (OBJECTIVES.includes(body.objective as Objective) ? body.objective : "balanced") as Objective;
      const result = runOptimizer(cfg, params, objective);
      if (productId) {
        await saveSimulation(
          productId,
          cfg,
          "optimize",
          params.scenario,
          { objective, evaluations: result.evaluations, changes: result.changes.length, baseProfit: result.baseline.kpis.netProfit, bestProfit: result.best.kpis.netProfit, params },
          result,
          configVersion,
        );
      }
      return Response.json({ ...result, config: cfg, configVersion });
    }
    return Response.json({ error: "حالت تحلیل نامعتبر است" }, { status: 400 });
  } catch (e) {
    return apiFailure(e);
  }
}
