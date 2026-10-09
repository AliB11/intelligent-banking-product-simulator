import { apiFailure, readBody } from "@/lib/api";
import { getProduct, savePortfolioResult } from "@/db/repo";
import { analyzeResult } from "@/lib/engine/advisor";
import { simulatePortfolio } from "@/lib/engine/simulator";
import { normalizeConfig } from "@/lib/engine/templates";
import type { ProductConfig } from "@/lib/engine/types";
import { sanitizeParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await readBody(req)) as { productId?: number; config?: unknown; params?: unknown };
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
    const full = analyzeResult(cfg, simulatePortfolio(cfg, params));
    let simulationId: number | null = null;
    if (productId) {
      simulationId = await savePortfolioResult(productId, cfg, full);
    }
    return Response.json({ ...full, simulationId });
  } catch (e) {
    return apiFailure(e);
  }
}
