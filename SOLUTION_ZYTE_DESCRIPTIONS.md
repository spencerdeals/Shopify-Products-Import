# Solution: Getting Zyte Descriptions in CSV Export

## Problem Summary

Your Shopify CSV exports show only minimal descriptions (source links) instead of rich product descriptions:

```csv
Body (HTML): "<p><small>Source: <a href='...' rel='nofollow'>Wayfair product page</a></small></p>"
```

But when you test the same product URL in Zyte Playground, it **DOES return** rich descriptions with features and specifications.

## Root Cause

**The ZYTE_APIKEY environment variable is not set.**

Your `.env` file has it commented out:
```bash
# ZYTE_APIKEY=your_zyte_api_key_here
```

Without this API key:
- The `ZyteEnricher` is **completely disabled**
- CSV export cannot call Zyte API to fetch rich descriptions
- You only get the minimal fallback description (source link)

## The Solution

### Step 1: Set ZYTE_APIKEY

**Edit `.env` file:**

```bash
# Change FROM this (commented out):
# ZYTE_APIKEY=your_zyte_api_key_here

# TO this (uncommented with your actual key):
ZYTE_APIKEY=YOUR_ACTUAL_ZYTE_API_KEY_HERE
```

Get your Zyte API key from: https://app.zyte.com/

### Step 2: Restart Your Server

The environment variable is loaded when the server starts, so you MUST restart:

```bash
# Stop the server (Ctrl+C if running locally)
# Then start it again:
npm start
```

For Railway/production:
1. Go to Railway Dashboard
2. Navigate to your project → Variables
3. Add: `ZYTE_APIKEY` = `your_actual_api_key`
4. Railway will automatically redeploy

### Step 3: Re-export CSV

Once the API key is set and server restarted:
1. Process your products again (or use existing handles)
2. Export CSV via `/api/batch/csv/:batchId`
3. Check the Body (HTML) column

## How It Works

### The Enrichment Flow

```
1. CSV Export Requested
   ↓
2. For each product, check description length
   ↓
3. If description < 150 chars OR is link-only:
   → Call Zyte API with ZYTE_APIKEY
   → Extract description, features, specifications
   → Build rich HTML with tables and lists
   ↓
4. Write enriched description to CSV
```

### What You'll See After Fix

**Before (without ZYTE_APIKEY):**
```
[ZyteEnricher] ⚠️  ZYTE_APIKEY not set - enrichment disabled
[CSV] Added 3 rows for putnam-height-adjustable-standing-desks
```

**After (with ZYTE_APIKEY):**
```
[ZyteEnricher] ✅ Enabled with API key
[ZyteEnricher] Extracting from: https://www.wayfair.com/furniture/pdp/...
[ZyteEnricher] Raw data keys: name, description, features, specifications, ...
[CSV] ✅ Enriched putnam-height-adjustable-standing-desks via Zyte
[CSV] 🎯 Enriched 1/1 products via Zyte
```

## Expected CSV Output

### Before Fix:
```csv
Body (HTML)
"<p><small>Source: <a href=""..."" rel=""nofollow"">wayfair.com</a></small></p>"
```

### After Fix:
```csv
Body (HTML)
"<h2>Putnam Height Adjustable Standing Desks</h2>
<p>Transform your workspace with this premium electric standing desk featuring smooth height adjustment from 28"" to 48"". Built with a solid steel frame and eco-friendly desktop surface.</p>
<h3>Features</h3>
<ul>
  <li>Electric height adjustment with memory presets</li>
  <li>Heavy-duty steel frame supports up to 220 lbs</li>
  <li>Quiet dual-motor system</li>
  <li>Cable management tray included</li>
  <li>Anti-collision technology</li>
</ul>
<h3>Specifications</h3>
<table>
  <tr><td><strong>Dimensions</strong></td><td>60""W x 30""D x 28-48""H</td></tr>
  <tr><td><strong>Weight Capacity</strong></td><td>220 lbs</td></tr>
  <tr><td><strong>Material</strong></td><td>Steel Frame, Laminate Top</td></tr>
</table>
<p><small>Source: <a href=""..."" rel=""nofollow"">wayfair.com</a></small></p>"
```

## Testing the Fix

### Test 1: Verify API Key is Set

```bash
node -e "require('dotenv').config(); console.log('ZYTE_APIKEY:', process.env.ZYTE_APIKEY ? 'SET ✅' : 'NOT SET ❌')"
```

### Test 2: Test Zyte API Directly

```bash
export ZYTE_APIKEY=your_key
node test-zyte-api.js "https://www.wayfair.com/furniture/pdp/the-twillery-co-putnam-height-adjustable-standing-desks-w008127716.html"
```

This will show you exactly what Zyte returns.

### Test 3: Test CSV Export (if you have products in Torso)

```bash
node test-csv-export-with-zyte.js
```

This will:
- Check if ZYTE_APIKEY is set
- Export a test CSV
- Analyze the Body (HTML) content
- Tell you if enrichment worked

## Troubleshooting

### Issue: Still getting short descriptions

**Check:**
1. ✅ ZYTE_APIKEY is set (not commented)
2. ✅ Server was restarted after setting key
3. ✅ Product has `canonical_url` in database
4. ✅ Product's existing description is < 150 chars

**View logs for:**
```
[ZyteEnricher] ✅ Enabled with API key
```

If you see:
```
[ZyteEnricher] ⚠️  ZYTE_APIKEY not set - enrichment disabled
```
Then the key is NOT set or server wasn't restarted.

### Issue: Zyte API errors

**Check logs for:**
```
[ZyteEnricher] ⚠️  Failed: [error message]
```

Common errors:
- `401` = Invalid API key
- `timeout` = Page took too long (>45s) - not an error, just skipped
- `No product data returned` = Zyte couldn't extract data from that URL

### Issue: Product not in Torso database

If you get:
```
Product not found in Torso: handle-name
```

This means the product hasn't been processed through the batch system yet. You need to:
1. Process the product through `/api/batch/process` first
2. Then export CSV

## Why This Approach?

The system has TWO stages:

### Stage 1: Initial Scraping (Batch Processing)
- Scrapes product during import
- Builds basic description with what's available
- Stores in Torso database
- **This already happened for your products**

### Stage 2: CSV Export Enrichment
- Re-checks if description is insufficient (< 150 chars)
- If yes, calls Zyte API again to get better data
- Builds rich description with features/specs
- **This is where ZYTE_APIKEY is needed**

This two-stage approach:
✅ Allows importing products quickly (Stage 1)
✅ Enriches only when needed during export (Stage 2)
✅ Avoids unnecessary API calls
✅ Provides fallback if Zyte fails

## Summary

**To fix your CSV descriptions:**

1. **Set ZYTE_APIKEY** in `.env` or Railway environment variables
2. **Restart server** to load the new environment variable
3. **Re-export CSV** - descriptions will now be enriched
4. **Import to Shopify** - rich descriptions with features and specs

That's it! The code is already in place and working - it just needs the API key to activate.

## Next Steps

Once you've set the API key and verified it works:

1. ✅ Export a test CSV with 1-2 products
2. ✅ Verify Body (HTML) column has rich content
3. ✅ Import test CSV to Shopify staging
4. ✅ Verify descriptions display correctly in Shopify
5. ✅ Process full batch and export
6. ✅ Import to Shopify production

## Support Files

- `test-zyte-api.js` - Test Zyte API directly
- `test-zyte-enrichment.js` - Test enrichment module
- `test-csv-export-with-zyte.js` - Test full CSV export flow
- `ZYTE_TESTING_GUIDE.md` - Detailed troubleshooting guide
- `ZYTE_FIX_SUMMARY.md` - Technical implementation details

---

**TL;DR:** Uncomment `ZYTE_APIKEY` in `.env`, restart server, re-export CSV. Done!
