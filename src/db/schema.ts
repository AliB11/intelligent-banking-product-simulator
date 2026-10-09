import { integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import type { ProductConfig } from "../lib/engine/types";

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: varchar("code", { length: 40 }).notNull(),
  family: varchar("family", { length: 16 }).notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),
  config: jsonb("config").$type<ProductConfig>().notNull(),
  healthScore: integer("health_score"),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const simulations = pgTable("simulations", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 24 }).notNull(),
  scenario: varchar("scenario", { length: 32 }).notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProductRow = typeof products.$inferSelect;
export type SimulationRow = typeof simulations.$inferSelect;
