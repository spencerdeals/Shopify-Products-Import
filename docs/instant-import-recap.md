# Instant Import Project Recap

## 🎯 Objective
The Instant Import feature provides a fast, PDF-first quote tool for special orders. It extracts product data (via scraped links or uploads), calculates landed costs using SDL's margin rules, and auto-generates Shopify draft orders with embedded quote data.

## 🧭 Current Status
- Frontend and backend are merged but undergoing final cleanup.
- `fastScraper.js` merge conflicts were just resolved.
- Bolt OAuth integration is underway to support GitHub login + syncing vendor link sources.
- All major backend logic and PDF rendering are functional, with endpoint routing in place.

## 📁 Key Files & Endpoints
**Backend Files**
- `backend/quote.js` → Handles quote generation from URLs/PDFs  
- `backend/fastScraper.js` → Vendor detection + scraping  
- `vendors/index.js` → Vendor-specific scraping logic  
- `routes/quote.js` → Express router for `/quote`  
- `routes/fastScraper.js` → Express router for `/fast-scraper`  
- `utils/priceUtils.js`, `volumeUtils.js`, etc. → Margin, freight, duty logic

**Frontend Files**
- `src/pages/Quote.tsx` → PDF-based quote UI  
- `src/components/StepBar.tsx`, `VendorFeesTable.tsx`, `ApproveButton.tsx`

**Endpoints**
- `POST /quote` → Generates quote from product data  
- `POST /fast-scraper` → Detects vendor and scrapes product info  
- `GET /health` → Basic health check

## 🔑 Required .env Variables (names only)

PORT
NODE_ENV
SCRAPINGBEE_API_KEY
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_STORE_URL
SHOPIFY_ACCESS_TOKEN
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
JWT_SECRET

## 🌐 Deploy & Health Check
- Railway deploy URL (current): `https://so-quote.fly.dev/`  
- Health: `GET /health` → `{ status: "ok" }`

## 🧠 Decisions & Fixes
- Default freight: **$6/ft³** based on 20′ container at 75% capacity.  
- Margin logic: **"SDL import margin"** (volume-based).  
- Code word **"continue banana"** triggers V3 quote UI.  
- Conflict in `fastScraper.js` resolved by restoring the correct Express route + `scrapeVendor` call.  
- Frontend PDF layout now matches final SDL brand theme.

## 📌 Next Steps
- Finish **GitHub OAuth with Bolt** and test session flow.  
- Clean up remaining PR conflicts (if any).  
- Final test pass across link-to-quote and PDF upload flow.  
- **Ship MVP** and demo to team.