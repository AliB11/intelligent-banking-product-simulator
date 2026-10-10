import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "@/lib/api";
import { products, simulations } from "@/db/schema";
import { analyzeResult } from "@/lib/engine/advisor";
import { QUICK_PARAMS, simulatePortfolio } from "@/lib/engine/simulator";
import { normalizeConfig, SEED_TEMPLATE_KEYS, templateConfig } from "@/lib/engine/templates";
import { ENGINE_VERSION } from "@/lib/engine/version";
import type { FullAlmResult, FullResult, ProductConfig } from "@/lib/engine/types";

let ready: Promise<void> | null = null;

/** Prototype-only lazy schema initialization; additive upgrades preserve all existing products/history. */
export function ensureDb(): Promise<void> {
  if (!ready) {
    ready = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(731405)`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS "products" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "code" varchar(40) NOT NULL,
        "family" varchar(16) NOT NULL,
        "kind" varchar(24) NOT NULL,
        "config" jsonb NOT NULL,
        "config_version" integer DEFAULT 1 NOT NULL,
        "health_score" integer,
        "health_engine_version" varchar(40),
        "status" varchar(16) DEFAULT 'draft' NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )`);
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS "simulations" (
        "id" serial PRIMARY KEY NOT NULL,
        "product_id" integer NOT NULL,
        "config_version" integer,
        "engine_version" varchar(40) DEFAULT 'legacy' NOT NULL,
        "type" varchar(24) NOT NULL,
        "scenario" varchar(32) NOT NULL,
        "summary" jsonb NOT NULL,
        "result" jsonb NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "simulations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action
      )`);
      await tx.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "config_version" integer DEFAULT 1 NOT NULL`);
      await tx.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "health_engine_version" varchar(40)`);
      await tx.execute(sql`ALTER TABLE "simulations" ADD COLUMN IF NOT EXISTS "config_version" integer`);
      await tx.execute(sql`ALTER TABLE "simulations" ADD COLUMN IF NOT EXISTS "engine_version" varchar(40) DEFAULT 'legacy' NOT NULL`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS "simulations_latest_idx" ON "simulations" ("product_id", "type", "config_version", "engine_version", "created_at" DESC, "id" DESC)`);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS "simulations_history_idx" ON "simulations" ("product_id", "created_at" DESC, "id" DESC)`);
      const r = await tx.select({ n: sql<number>`count(*)::int` }).from(products);
      if ((r[0]?.n ?? 0) === 0) {
        for (const key of SEED_TEMPLATE_KEYS) {
          const cfg = templateConfig(key);
          if (!cfg) continue;
          const full = analyzeResult(cfg, simulatePortfolio(cfg, QUICK_PARAMS));
          await tx.insert(products).values({
            name: cfg.name, code: cfg.code, family: cfg.family, kind: cfg.kind, config: cfg,
            healthScore: full.health.score, healthEngineVersion: ENGINE_VERSION,
          });
        }
      }
    }).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export interface SimSummary {
  id: number;
  type: string;
  scenario: string;
  summary: Record<string, unknown>;
  createdAt: string;
}

export interface ProductItem {
  id: number;
  name: string;
  code: string;
  family: string;
  kind: string;
  config: ProductConfig;
  configVersion: number;
  healthScore: number | null;
  status: string;
  updatedAt: string;
  latest: SimSummary | null;
}

const currentResult = and(
  eq(simulations.configVersion, products.configVersion),
  eq(simulations.engineVersion, ENGINE_VERSION),
);

export async function listProducts(): Promise<ProductItem[]> {
  await ensureDb();
  const rows = await db.select().from(products).orderBy(desc(products.updatedAt), desc(products.id));
  const sims = await db
    .selectDistinctOn([simulations.productId], { id: simulations.id, productId: simulations.productId, type: simulations.type, scenario: simulations.scenario, summary: simulations.summary, configVersion: simulations.configVersion, createdAt: simulations.createdAt })
    .from(simulations)
    .innerJoin(products, eq(products.id, simulations.productId))
    .where(and(eq(simulations.type, "monte_carlo"), currentResult))
    .orderBy(simulations.productId, desc(simulations.createdAt), desc(simulations.id));
  const latest = new Map(sims.map((s) => [s.productId, { version: s.configVersion, item: { id: s.id, type: s.type, scenario: s.scenario, summary: s.summary, createdAt: s.createdAt.toISOString() } }]));
  return rows.map((r) => ({
    id: r.id, name: r.name, code: r.code, family: r.family, kind: r.kind,
    config: normalizeConfig(r.config), configVersion: r.configVersion,
    healthScore: r.healthEngineVersion === ENGINE_VERSION ? r.healthScore : null,
    status: r.status, updatedAt: r.updatedAt.toISOString(), latest: latest.get(r.id)?.version === r.configVersion ? latest.get(r.id)!.item : null,
  }));
}

export async function getProduct(id: number) {
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) return null;
  await ensureDb();
  const [r] = await db.select().from(products).where(eq(products.id, id));
  if (!r) return null;
  return {
    id: r.id, config: normalizeConfig(r.config), configVersion: r.configVersion,
    healthScore: r.healthEngineVersion === ENGINE_VERSION ? r.healthScore : null,
    status: r.status, updatedAt: r.updatedAt.toISOString(),
  };
}

export async function createProduct(cfg: ProductConfig, healthScore: number | null) {
  await ensureDb();
  const c = normalizeConfig(cfg);
  const [r] = await db.insert(products).values({
    name: c.name, code: c.code, family: c.family, kind: c.kind, config: c,
    healthScore, healthEngineVersion: ENGINE_VERSION,
  }).returning({ id: products.id, configVersion: products.configVersion });
  return { ...r, config: c };
}

export async function updateProduct(id: number, cfg: ProductConfig, extra: { healthScore?: number | null; status?: string; expectedVersion?: number } = {}) {
  await ensureDb();
  const c = normalizeConfig(cfg);
  const [r] = await db.update(products).set({
    name: c.name, code: c.code, family: c.family, kind: c.kind, config: c,
    configVersion: sql`${products.configVersion} + 1`,
    ...(extra.healthScore !== undefined ? { healthScore: extra.healthScore, healthEngineVersion: ENGINE_VERSION } : { healthScore: null, healthEngineVersion: null }),
    status: extra.status ?? "draft", updatedAt: new Date(),
  }).where(and(eq(products.id, id), extra.expectedVersion === undefined ? undefined : eq(products.configVersion, extra.expectedVersion)))
    .returning({ id: products.id, configVersion: products.configVersion });
  if (!r) {
    if (!await getProduct(id)) throw new ApiError("محصول یافت نشد", 404);
    throw new ApiError("نسخه محصول تغییر کرده است؛ صفحه را تازه‌سازی و ویرایش را دوباره اعمال کنید.", 409);
  }
  return r;
}

export async function deleteProduct(id: number) {
  await ensureDb();
  const [r] = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
  if (!r) throw new ApiError("محصول یافت نشد", 404);
}

/** All analyses share the same row lock/revision guard; timestamps alone cannot detect stale results. */
async function persistResult(
  productId: number, cfg: ProductConfig, type: string, scenario: string,
  summary: Record<string, unknown>, result: unknown, expectedVersion?: number, healthScore?: number,
): Promise<number> {
  await ensureDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
    if (!row) throw new ApiError("محصول یافت نشد", 404);
    if ((expectedVersion !== undefined && row.configVersion !== expectedVersion) ||
        JSON.stringify(normalizeConfig(row.config)) !== JSON.stringify(normalizeConfig(cfg))) {
      throw new ApiError("محصول هنگام محاسبه تغییر کرده است؛ تحلیل را دوباره اجرا کنید.", 409);
    }
    const [saved] = await tx.insert(simulations).values({
      productId, type, scenario, configVersion: row.configVersion, engineVersion: ENGINE_VERSION,
      summary: { ...summary, configVersion: row.configVersion, engineVersion: ENGINE_VERSION },
      result: result && typeof result === "object" && !Array.isArray(result)
        ? { ...result, config: normalizeConfig(cfg) } : { data: result, config: normalizeConfig(cfg) },
    }).returning({ id: simulations.id });
    if (healthScore !== undefined) {
      await tx.update(products).set({ healthScore, healthEngineVersion: ENGINE_VERSION, status: "simulated" }).where(eq(products.id, productId));
    }
    return saved.id;
  });
}

export async function saveSimulation(
  productId: number, cfg: ProductConfig, type: string, scenario: string,
  summary: Record<string, unknown>, result: unknown, expectedVersion?: number,
): Promise<number> {
  return persistResult(productId, cfg, type, scenario, summary, result, expectedVersion);
}

export async function savePortfolioResult(productId: number, cfg: ProductConfig, full: FullResult, expectedVersion?: number): Promise<number> {
  return persistResult(productId, cfg, "monte_carlo", full.sim.params.scenario, summarize(full), full, expectedVersion, full.health.score);
}

export async function listSimulations(productId: number): Promise<SimSummary[]> {
  await ensureDb();
  const rows = await db.select({ id: simulations.id, type: simulations.type, scenario: simulations.scenario, summary: simulations.summary, createdAt: simulations.createdAt })
    .from(simulations).where(eq(simulations.productId, productId))
    .orderBy(desc(simulations.createdAt), desc(simulations.id)).limit(40);
  return rows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }));
}

export async function latestFullResult(productId: number, configVersion?: number): Promise<FullResult | null> {
  await ensureDb();
  const [r] = await db.select({ result: simulations.result }).from(simulations)
    .innerJoin(products, eq(products.id, simulations.productId))
    .where(and(eq(simulations.productId, productId), eq(simulations.type, "monte_carlo"), currentResult, configVersion === undefined ? undefined : eq(products.configVersion, configVersion)))
    .orderBy(desc(simulations.createdAt), desc(simulations.id)).limit(1);
  return r ? (r.result as FullResult) : null;
}

export async function latestAlmResult(productId: number, configVersion?: number): Promise<{ id: number; createdAt: string; summary: Record<string, unknown>; result: FullAlmResult } | null> {
  await ensureDb();
  const [r] = await db.select({ id: simulations.id, createdAt: simulations.createdAt, summary: simulations.summary, result: simulations.result })
    .from(simulations).innerJoin(products, eq(products.id, simulations.productId))
    .where(and(eq(simulations.productId, productId), eq(simulations.type, "alm"), currentResult, configVersion === undefined ? undefined : eq(products.configVersion, configVersion)))
    .orderBy(desc(simulations.createdAt), desc(simulations.id)).limit(1);
  return r ? { id: r.id, createdAt: r.createdAt.toISOString(), summary: r.summary, result: r.result as FullAlmResult } : null;
}

export function summarize(full: FullResult): Record<string, unknown> {
  const k = full.sim.kpis;
  return {
    netProfit: k.netProfit, raroc: k.raroc, roa: k.roa, nplEnd: k.nplEnd, approvalRate: k.approvalRate,
    volume: k.volume, apr: k.apr, realProfit: k.realProfit, loyaltyRoi: k.loyaltyRoi, inclusion: k.inclusion,
    health: full.health.score, grade: full.health.grade, compliance: full.compliance.score,
    runs: full.sim.params.runs, customers: full.sim.params.customers, horizon: full.sim.params.horizon,
    params: full.sim.params,
  };
}
