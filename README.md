# SDL — Shopify Product Import Calculator

Paste product links → Zyte fetch → parser (Amazon/Luna/generic) → (backup) ChatGPT parsing → per-item Box L/W/H (in) and Margin → compute retail rounded up to the nearest $5 → export Shopify Product CSV.

## Deploy (Railway)

1. Create a new Railway project and connect your repo.
2. Add env vars:
   - `ZYTE_API_KEY` (required)
   - `OPENAI_API_KEY` (optional)
   - `SHOPIFY_STORE_DOMAIN` (optional)
   - `SHOPIFY_ADMIN_TOKEN` (optional)
   - `PORT` (optional, default 8080)
3. `npm i` → `npm start`. Open your Railway URL.

## Use

1. Paste URLs → Preview.
2. Edit per row: Cost, Margin %, Box L/W/H (in) (auto-calcs Volume (ft³)).
3. Click Export CSV to download `sdl_shopify_import.csv`.

## CSV Columns

Includes your needed Shopify fields plus meta columns for dimensions:

- **Core**: Handle, Title, Body (HTML), Vendor, Product Category, Type, Tags, Published, Option1 Name/Value, Variant Price (rounded), Image Src/Alt, Cost per item, Status, SEO fields.
- **Meta**: Meta: Source URL, Meta: Auto Collections, Meta: Box Length (in), Meta: Box Width (in), Meta: Box Height (in), Meta: Box Volume (ft3).

Note: Shopify ignores unknown columns, but keeps recognized ones. Dimension fields are exported as meta columns for your records.

## Endpoints

- **POST /api/preview** → `{ urls, marginPercent?, overrides? }` → returns items with computed retail & volume.
- **POST /api/build-csv** → same payload → returns CSV.
- **GET /api/collections** → optional; fetches collections if Shopify creds set.
- **GET /api/health** → `{ ok: true }`.

## Validation

- Preview shows image/title/vendor; default margin 45%; retail rounded to $5.
- Per-row edits for cost, margin, L/W/H recompute retail and volume.
- Exported CSV contains dimension meta columns and required Shopify columns.

Rollback: revert to previous commit.
