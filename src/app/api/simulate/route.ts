import { getProduct, saveSimulation, summarize, updateProduct } from "@/db/repo";
import { analyzeResult } from "@/lib/engine/advisor";
import { simulatePortfolio } from "@/lib/engine/simulator";
import { normalizeConfig } from "@/lib/engine/templates";
import type { ProductConfig } from "@/lib/engine/types";
import { sanitizeParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { productId?: number; config?: unknown; params?: unknown };
    const params = sanitizeParams(body.params);
    let cfg: ProductConfig;
    let productId: number | null = null;
    if (body.productId) {
      const p = await getProduct(Number(body.productId));
      if (!p) return Response.json({ error: "محصول یافت نشد" }, { status: 404 });
      cfg = p.config;
      productId = p.id;
    } else {
      cfg = normalizeConfig(body.config);
    }
    const full = analyzeResult(cfg, simulatePortfolio(cfg, params));
    let simulationId: number | null = null;
    if (productId) {
      simulationId = await saveSimulation(productId, "monte_carlo", params.scenario, summarize(full), full);
      await updateProduct(productId, cfg, { healthScore: full.health.score, status: "simulated" });
    }
    return Response.json({ ...full, simulationId });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
