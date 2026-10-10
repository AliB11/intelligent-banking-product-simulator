import { apiFailure, assertSameOrigin, configVersion as parseVersion, readBody, productId as parseId } from "@/lib/api";
import { deleteProduct, getProduct, listSimulations, updateProduct } from "@/db/repo";
import { analyzeResult } from "@/lib/engine/advisor";
import { QUICK_PARAMS, simulatePortfolio } from "@/lib/engine/simulator";
import { normalizeConfig } from "@/lib/engine/templates";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const product = await getProduct(parseId(id));
    if (!product) return Response.json({ error: "محصول یافت نشد" }, { status: 404 });
    const history = await listSimulations(product.id);
    return Response.json({ product, history });
  } catch (e) { return apiFailure(e); }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const parsedId = parseId(id);
    const body = (await readBody(req, true)) as { config?: unknown; configVersion?: unknown };
    const requestedVersion = body.configVersion === undefined ? undefined : parseVersion(body.configVersion);
    const product = await getProduct(parsedId);
    if (!product) return Response.json({ error: "محصول یافت نشد" }, { status: 404 });
    const expectedVersion = requestedVersion ?? product.configVersion;
    const cfg = normalizeConfig(body.config);
    const full = analyzeResult(cfg, simulatePortfolio(cfg, QUICK_PARAMS));
    const updated = await updateProduct(product.id, cfg, { healthScore: full.health.score, status: "draft", expectedVersion });
    return Response.json({ ...updated, config: cfg });
  } catch (e) {
    return apiFailure(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const { id } = await ctx.params;
    await deleteProduct(parseId(id));
    return Response.json({ ok: true });
  } catch (e) { return apiFailure(e); }
}
