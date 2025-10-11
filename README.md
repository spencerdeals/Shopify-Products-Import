# SDL — Shopify Product Import

New app (separate from "Instant Import"). Paste links → Zyte fetch → parser (Amazon/Luna/generic) → (backup) ChatGPT parsing → per-item multi-box dimensions (add with "+" button) and margin → retail rounded up to nearest $5 → export Shopify Product CSV.

## Run (Railway or local)

Env: `ZYTE_API_KEY` (required), `OPENAI_API_KEY` (optional), `SHOPIFY_STORE_DOMAIN`/`SHOPIFY_ADMIN_TOKEN` (optional), `PORT=8080`

```
npm i → npm start
```

Open `/api/health` → `{ ok: true }`

Visit `/` → paste URLs → Preview → per-row edits (Cost, Margin, Boxes) → Export CSV

## CSV

Includes core Shopify columns plus meta columns:

- `Meta: Box Count`, `Meta: Box Total Volume (ft3)`, `Meta: Boxes JSON`
- Per-box columns for up to 6 boxes: `Meta: BoxN L/W/H (in)`, `Meta: BoxN ft3`

Shopify ignores unknown columns safely; these metas are for operations/records.

## Notes

- Default margin 45%; per-row override.
- Retail prices have no cents and are divisible by 5.
- Optional Shopify connection fetches collections for auto-suggestions.

## Validation checklist

- Fresh repo root reflects SDL — Shopify Product Import files (no legacy Instant Import files).
- `/api/health` returns `{ ok: true }`.
- Preview: paste 1–2 URLs → see image/title/vendor; edit Cost/Margin; expand Boxes → add multiple boxes (L/W/H); values persist in row state.
- Retail auto-updates on margin/cost; rounded up to nearest $5.
- Export: CSV contains Shopify fields + box metas; price divisible by 5; meta JSON contains all entered boxes.

## (Optional) Git steps

If git is available, commit & push:

```bash
git checkout -B feat/shopify-product-import
git add -A
git commit -m "feat: new SDL Shopify Product Import app w/ multi-box dims, margin, $5 rounding, Zyte+GPT parsing"
git push -u origin feat/shopify-product-import
```
