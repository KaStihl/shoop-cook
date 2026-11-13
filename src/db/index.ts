import fs from 'node:fs';
import path from 'node:path';
import type { StatementSync, SQLInputValue } from 'node:sqlite';
import { eq } from 'drizzle-orm';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { BUILTIN } from '@/lib/canonical';
import * as schema from './schema';

const DDL = `
CREATE TABLE IF NOT EXISTS ingredients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, role TEXT NOT NULL, diet TEXT NOT NULL,
  allergens TEXT NOT NULL, lactose_free INTEGER NOT NULL, gluten_free INTEGER NOT NULL,
  kcal REAL, protein REAL, carbs REAL, fat REAL, nutrition_source TEXT NOT NULL DEFAULT 'none',
  baseline_price REAL, baseline_pack REAL NOT NULL DEFAULT 1000, piece_grams REAL, origin TEXT NOT NULL DEFAULT 'builtin');
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, store TEXT NOT NULL,
  name TEXT NOT NULL, search_name TEXT NOT NULL, brand TEXT, ean TEXT, pack_text TEXT, pack_qty REAL, pack_unit TEXT,
  loose INTEGER NOT NULL DEFAULT 0, price REAL NOT NULL, deal_price REAL, unit_price REAL, valid_from TEXT, valid_to TEXT,
  category TEXT, image TEXT, source_url TEXT NOT NULL, scraped_at TEXT NOT NULL, ingredient_id TEXT, mapping_source TEXT);
CREATE INDEX IF NOT EXISTS products_ingredient ON products (ingredient_id);
CREATE INDEX IF NOT EXISTS products_store ON products (store);
CREATE INDEX IF NOT EXISTS products_hash ON products (hash);
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, price REAL NOT NULL, deal_price REAL, recorded_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS price_history_product ON price_history (product_id);
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL, ingredients TEXT NOT NULL,
  ingredient_key TEXT NOT NULL UNIQUE, steps TEXT NOT NULL, prep_minutes INTEGER NOT NULL, tags TEXT NOT NULL,
  source TEXT NOT NULL, feedback INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, kind TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refresh_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL, item_count INTEGER NOT NULL DEFAULT 0, new_count INTEGER NOT NULL DEFAULT 0, message TEXT);
`;

interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

type Db = BaseSQLiteDatabase<'sync', RunResult>;

/** Statement wrapper exposing the subset of the better-sqlite3 API that Drizzle's sync session calls. */
class Statement {
  constructor(private readonly stmt: StatementSync) {}
  run(...params: SQLInputValue[]): RunResult {
    const result = this.stmt.run(...params);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }
  all(...params: SQLInputValue[]): unknown[] {
    return this.stmt.all(...params);
  }
  get(...params: SQLInputValue[]): unknown {
    return this.stmt.get(...params);
  }
  raw(): this {
    this.stmt.setReturnArrays(true);
    return this;
  }
}

/**
 * Uses Node's built-in SQLite (node:sqlite) behind Drizzle's synchronous SQLite session, so the app needs
 * no native addon or install script. Loaded via getBuiltinModule to keep bundlers out of the way.
 */
function open(): Db {
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'jedlokos.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const sqlite = new DatabaseSync(file, { timeout: 10000 });
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec(DDL);

  const client = {
    prepare: (query: string) => new Statement(sqlite.prepare(query)),
    transaction: <T>(fn: (tx: unknown) => T) => {
      const run = (mode: string) => (tx: unknown): T => {
        sqlite.exec(`BEGIN ${mode}`);
        try {
          const result = fn(tx);
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      };
      return { deferred: run('DEFERRED'), immediate: run('IMMEDIATE'), exclusive: run('EXCLUSIVE') };
    },
  };
  const dialect = new SQLiteSyncDialect();
  const session = new BetterSQLiteSession(client as never, dialect, undefined);
  const instance = new BaseSQLiteDatabase('sync', dialect, session, undefined) as Db;

  instance
    .insert(schema.ingredients)
    .values(BUILTIN.map((s) => ({
      id: s.id, name: s.name, category: s.category, role: s.role, diet: s.diet, allergens: s.allergens,
      lactoseFree: s.lactoseFree, glutenFree: !s.allergens.includes('gluten'),
      kcal: s.kcal, protein: s.protein, carbs: s.carbs, fat: s.fat, nutritionSource: 'builtin',
      baselinePrice: s.baselinePrice, baselinePack: s.baselinePack, pieceGrams: s.pieceGrams, origin: 'builtin',
    })))
    .onConflictDoNothing()
    .run();
  return instance;
}

const holder = globalThis as typeof globalThis & { __jedlokosDb?: Db };

export const db: Db = (holder.__jedlokosDb ??= open());
export { schema };

export function cacheGet<T>(key: string): T | undefined {
  const row = db.select().from(schema.cache).where(eq(schema.cache.key, key)).get();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function cacheSet(key: string, kind: string, value: unknown): void {
  const row = { key, kind, value: JSON.stringify(value), createdAt: new Date().toISOString() };
  db.insert(schema.cache).values(row).onConflictDoUpdate({ target: schema.cache.key, set: row }).run();
}
