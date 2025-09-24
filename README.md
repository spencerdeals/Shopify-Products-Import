# bermuda-import-calculator BINGO

## Instant Import — Runbook (SDL)

This is the minimal, repeatable guide to run, debug, and update Instant Import.

### 1) Environment (Railway → Variables)
Required:
- `ZYTE_API_KEY`
- `OPENAI_API_KEY`
- `SHOPIFY_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`
- `ADMIN_PASSWORD`
- `CORS_ALLOWLIST`

Optional:
- `OPENAI_MODEL` (defaults to `gpt-4.1-mini`)
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (if you use OrderTracker)

### 2) Health checks
- **GET** `/instant-import/health` → `{ ok: true }`
- **GET** `/api/ai/config` → `{ model, hasKey, keySuffix }` (if aiEnrich is mounted)

### 3) Endpoints
- **POST** `/` and `/instant-import`  
  Body: Zyte JSON (single item, `{items:[...]}`, or array) → returns `{ meta, products }`
- **POST** `/api/ai/enrich` (if present)  
  Body: `{ product?: {...}, prompt?: "..." }` → AI-enriched attributes

### 4) Logs (Railway)
Look for a concise line per request:
```
[META] zyte | Wayfair | $899.99 | Modern 3-Seat Sofa...
[instant-import] meta: {"count":1,"engine":"zyte"} retailer: Wayfair
```

### 5) Debugging
**No products returned?**
- Check Zyte API key validity
- Verify CORS allowlist includes your domain
- Look for `[instant-import] error:` in logs

**Low confidence scores?**
- GPT fallback should activate automatically
- Check OpenAI API key and quota
- Review product URL format

**CORS errors?**
- Update `CORS_ALLOWLIST` environment variable
- Format: `https://domain1.com,https://domain2.com`
- Restart service after changes

### 6) Updates
1. **Code changes**: Push to `feature/instant-import` branch
2. **Environment**: Update Railway variables
3. **Deploy**: Merge to `main` triggers auto-deploy
4. **Verify**: Check health endpoints post-deploy

### 7) Monitoring
- **Success rate**: Monitor `[META]` log frequency
- **Error patterns**: Watch for repeated `[instant-import] error:` messages
- **Performance**: Track response times in Railway metrics
- **Costs**: Monitor Zyte and OpenAI API usage

---

## Docs
- **Instant Import Project Recap:** [docs/instant-import-recap.md](docs/instant-import-recap.md)