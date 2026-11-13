import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const ingredients = sqliteTable('ingredients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  role: text('role').notNull(),
  diet: text('diet').notNull(),
  allergens: text('allergens', { mode: 'json' }).$type<string[]>().notNull(),
  lactoseFree: integer('lactose_free', { mode: 'boolean' }).notNull(),
  glutenFree: integer('gluten_free', { mode: 'boolean' }).notNull(),
  kcal: real('kcal'),
  protein: real('protein'),
  carbs: real('carbs'),
  fat: real('fat'),
  nutritionSource: text('nutrition_source').notNull().default('none'),
  baselinePrice: real('baseline_price'),
  baselinePack: real('baseline_pack').notNull().default(1000),
  pieceGrams: real('piece_grams'),
  origin: text('origin').notNull().default('builtin'),
});

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  hash: text('hash').notNull(),
  store: text('store').notNull(),
  name: text('name').notNull(),
  searchName: text('search_name').notNull(),
  brand: text('brand'),
  ean: text('ean'),
  packText: text('pack_text'),
  packQty: real('pack_qty'),
  packUnit: text('pack_unit'),
  loose: integer('loose', { mode: 'boolean' }).notNull().default(false),
  price: real('price').notNull(),
  dealPrice: real('deal_price'),
  unitPrice: real('unit_price'),
  validFrom: text('valid_from'),
  validTo: text('valid_to'),
  category: text('category'),
  image: text('image'),
  sourceUrl: text('source_url').notNull(),
  scrapedAt: text('scraped_at').notNull(),
  ingredientId: text('ingredient_id'),
  mappingSource: text('mapping_source'),
});

export const priceHistory = sqliteTable('price_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productId: integer('product_id').notNull(),
  price: real('price').notNull(),
  dealPrice: real('deal_price'),
  recordedAt: text('recorded_at').notNull(),
});

export const recipes = sqliteTable('recipes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  ingredients: text('ingredients', { mode: 'json' }).$type<{ id: string; grams: number }[]>().notNull(),
  ingredientKey: text('ingredient_key').notNull().unique(),
  steps: text('steps', { mode: 'json' }).$type<string[]>().notNull(),
  prepMinutes: integer('prep_minutes').notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
  source: text('source').notNull(),
  feedback: integer('feedback').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

export const cache = sqliteTable('cache', {
  key: text('key').primaryKey(),
  kind: text('kind').notNull(),
  value: text('value').notNull(),
  createdAt: text('created_at').notNull(),
});

export const refreshLog = sqliteTable('refresh_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  store: text('store').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull(),
  itemCount: integer('item_count').notNull().default(0),
  newCount: integer('new_count').notNull().default(0),
  message: text('message'),
});
