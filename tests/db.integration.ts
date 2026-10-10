// Explicit opt-in: TEST_DATABASE_URL must point to a disposable PostgreSQL database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { db, getPool } from "../src/db";
import { products, simulations } from "../src/db/schema";
import {
  createProduct, deleteProduct, ensureDb, getProduct, latestAlmResult, latestFullResult,
  listProducts, listSimulations, savePortfolioResult, saveSimulation, updateProduct,
} from "../src/db/repo";
import { ApiError } from "../src/lib/api";
import { analyzeResult } from "../src/lib/engine/advisor";
import { runFullAlmAnalysis } from "../src/lib/engine/alm";
import { QUICK_PARAMS, simulatePortfolio } from "../src/lib/engine/simulator";
import { mergeConfig, templateConfig } from "../src/lib/engine/templates";
import type { ProductConfig } from "../src/lib/engine/types";
import { ENGINE_VERSION } from "../src/lib/engine/version";

if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to a disposable database; integration tests never use DATABASE_URL implicitly.");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

before(async () => { await ensureDb(); });
after(async () => { await getPool().end(); });

const rejected = (status: number) => (e: unknown) => e instanceof ApiError && e.status === status;
const fullFor = (cfg: ProductConfig, seed = 1405) => analyzeResult(cfg, simulatePortfolio(cfg, { ...QUICK_PARAMS, customers: 500, runs: 1, horizon: 24, seed }));
async function withProduct(fn: (id: number, cfg: ProductConfig, version: number) => Promise<void>) {
  const cfg = mergeConfig(templateConfig("negin_farapuya")!, { name: `DB AUDIT — ${randomUUID()}` });
  const p = await createProduct(cfg, 42);
  try { await fn(p.id, cfg, p.configVersion); }
  finally { if (await getProduct(p.id)) await deleteProduct(p.id); }
}

test("persistence records the exact configuration revision, engine and reproducible inputs", async () => {
  await withProduct(async (id, cfg, version) => {
    const full = fullFor(cfg, 73);
    const saved = await savePortfolioResult(id, cfg, full, version);
    const [row] = await db.select().from(simulations).where(eq(simulations.id, saved));
    assert.equal(row.configVersion, version);
    assert.equal(row.engineVersion, ENGINE_VERSION);
    assert.deepEqual((row.result as { config: ProductConfig }).config, cfg);
    assert.equal((row.summary.params as { seed: number }).seed, 73);
    assert.equal((await getProduct(id))!.status, "simulated");
    assert.deepEqual((await latestFullResult(id))!.sim.kpis, full.sim.kpis);
    assert.equal((await listProducts()).find((p) => p.id === id)!.latest!.id, saved);
  });
});

test("all four analysis modes reject a result computed before an edit", async () => {
  await withProduct(async (id, cfg, version) => {
    const full = fullFor(cfg);
    const next = mergeConfig(cfg, { credit: { upfrontFee: 2 } });
    await updateProduct(id, next, { healthScore: 17, status: "draft", expectedVersion: version });
    await assert.rejects(savePortfolioResult(id, cfg, full, version), rejected(409));
    for (const type of ["stress", "sensitivity", "optimize", "alm"]) {
      await assert.rejects(saveSimulation(id, cfg, type, "base", {}, {}, version), rejected(409));
    }
    assert.equal((await listSimulations(id)).length, 0);
    const p = (await getProduct(id))!;
    assert.equal(p.healthScore, 17);
    assert.equal(p.status, "draft");
    assert.deepEqual(p.config, next);
  });
});

test("revision guards catch A→B→A edits even when the final configuration equals the original", async () => {
  await withProduct(async (id, cfg, version) => {
    const b = await updateProduct(id, mergeConfig(cfg, { tagline: "B" }), { expectedVersion: version });
    await updateProduct(id, cfg, { expectedVersion: b.configVersion });
    assert.deepEqual((await getProduct(id))!.config, cfg);
    await assert.rejects(savePortfolioResult(id, cfg, fullFor(cfg), version), rejected(409));
  });
});

test("old results remain invalid after an edit even with identical/reversed timestamps", async () => {
  await withProduct(async (id, cfg, version) => {
    await savePortfolioResult(id, cfg, fullFor(cfg), version);
    await updateProduct(id, mergeConfig(cfg, { name: `${cfg.name} edited` }), { expectedVersion: version });
    // Timestamp-only invalidation would incorrectly accept the old result here.
    await db.update(products).set({ updatedAt: new Date("1970-01-01T00:00:00Z") }).where(eq(products.id, id));
    assert.equal(await latestFullResult(id), null);
    assert.equal((await listProducts()).find((p) => p.id === id)!.latest, null);
    assert.equal((await listSimulations(id)).length, 1, "keep historical evidence");
  });
});

test("only one concurrent editor can update a given configuration revision", async () => {
  await withProduct(async (id, cfg, version) => {
    const results = await Promise.allSettled([
      updateProduct(id, mergeConfig(cfg, { tagline: "editor A" }), { expectedVersion: version }),
      updateProduct(id, mergeConfig(cfg, { tagline: "editor B" }), { expectedVersion: version }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected(409)(failed.reason));
    assert.equal((await getProduct(id))!.configVersion, version + 1);
  });
});

test("legacy engine results are historical only and cannot be displayed as current", async () => {
  await withProduct(async (id, cfg, version) => {
    const saved = await savePortfolioResult(id, cfg, fullFor(cfg), version);
    await db.update(simulations).set({ engineVersion: "legacy" }).where(eq(simulations.id, saved));
    assert.equal(await latestFullResult(id), null);
    assert.equal((await listProducts()).find((p) => p.id === id)!.latest, null);
    assert.equal((await listSimulations(id)).length, 1);
  });
});

test("ALM latest-result selection is deterministic and respects revisions", async () => {
  await withProduct(async (id, cfg, version) => {
    const full = runFullAlmAnalysis({ product: cfg, marketShare: 1, horizon: 24 });
    const a = await saveSimulation(id, cfg, "alm", "base", { seed: 1405 }, full, version);
    const b = await saveSimulation(id, cfg, "alm", "base", { seed: 1405 }, full, version);
    const timestamp = new Date("2026-10-10T12:00:00Z");
    for (const saved of [a, b]) await db.update(simulations).set({ createdAt: timestamp }).where(eq(simulations.id, saved));
    assert.equal((await latestAlmResult(id, version))!.id, b);
    await updateProduct(id, mergeConfig(cfg, { points: { usageRate: 80 } }), { expectedVersion: version });
    assert.equal(await latestAlmResult(id), null);
    assert.equal(await latestFullResult(id, version), null);
  });
});

test("deletion cascades history and mutations never falsely succeed for missing products", async () => {
  await withProduct(async (id, cfg, version) => {
    await savePortfolioResult(id, cfg, fullFor(cfg), version);
    await deleteProduct(id);
    assert.equal(await getProduct(id), null);
    assert.equal((await db.select().from(simulations).where(eq(simulations.productId, id))).length, 0);
    await assert.rejects(updateProduct(id, cfg), rejected(404));
    await assert.rejects(deleteProduct(id), rejected(404));
    await assert.rejects(saveSimulation(id, cfg, "stress", "base", {}, [], version), rejected(404));
    for (const invalid of [NaN, Infinity, 0, -1, 1.5, 2147483648]) assert.equal(await getProduct(invalid), null);
  });
});

test("pool bounds query time and recovers from a failed idle connection without an unhandled error", async () => {
  const pool = getPool();
  assert.ok(pool.listenerCount("error") > 0, "the permanent listener must exist before the test attaches its own listener");
  const c = await pool.connect();
  const r = await c.query("SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS timeout");
  const pid = r.rows[0].pid;
  assert.equal(r.rows[0].timeout, "15s");
  c.release();
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  let timeout: ReturnType<typeof setTimeout>;
  const idleFailure = new Promise<Error>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("idle connection did not report failure")), 5000);
    pool.once("error", resolve);
  });
  try {
    const killed = await admin.query("SELECT pg_terminate_backend($1) AS killed", [pid]);
    assert.equal(killed.rows[0].killed, true);
    const error = await idleFailure;
    assert.equal((error as Error & { code?: string }).code, "57P01");
    assert.equal((await pool.query("SELECT 1 AS ok")).rows[0].ok, 1);
  } finally {
    clearTimeout(timeout!);
    await admin.end();
  }
});
