// backend/fastScraper.js
// SDL Instant Import - production server with tiered price validation

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");

// ========= Scraper deps (your existing local modules) =========
const ZyteScraper = require("./zyteScraper");     // must export class with .enabled and .scrapeProduct(url)
const { parseProduct: parseWithGPT } = require("./gptParser"); // safe to call even if OPENAI key missing

// ========= Server init =========
const app = express();
const PORT = process.env.PORT || 8080;

// Behind Railway proxy => allow X-Forwarded-* from their LB
app.set("trust proxy", true);

// Body & static files
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// ========= CORS (strict allow-list + helpful logs) =========
const allowedOrigins = new Set([
  "http://localhost:8080",
  "http://localhost:3000", 
  "http://localhost:5173",
  "https://sdl.bm",
  "https://www.sdl.bm",
  "https://bermuda-import-calculator-production.up.railway.app",
]);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow curl/Postman/no-origin requests
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      console.warn(`CORS blocked origin: ${origin}`);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);

// ========= Rate limit with proper trust proxy handling =========
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: (req) => {
    return req.ip || 'unknown';
  },
});
app.use(limiter);

// ========= Health + Form =========
app.get("/ping", (_req, res) => {
  res.json({ ok: true, service: "instant-import" });
});
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "instant-import" });
});

// Form route
app.get("/form", (_req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ========= Scraping pipeline =========
const zyte = new ZyteScraper();
const USE_ZYTE = !!zyte && zyte.enabled;
const USE_GPT = !!process.env.OPENAI_API_KEY;

// Tiered price validation
function normalizeNumber(x) {
  if (typeof x === "number") return x;
  if (!x || typeof x !== "string") return NaN;
  const cleaned = x.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : NaN;
}

function detectTier(meta) {
  const nameish =
    (meta?.name || "") +
    " " +
    (Array.isArray(meta?.breadcrumbs) ? meta.breadcrumbs.join(" ") : meta?.category || "");
  const s = nameish.toLowerCase();
  const volFt3 = Number(meta?.volumeFt3 || 0);

  if (volFt3 > 20 || /(sectional|chaise|3[-\s]?seater|4[-\s]?seater)/.test(s)) {
    return { tier: "LARGE", min: 200 };
  }
  if (volFt3 >= 10 || /(sofa|couch|loveseat)/.test(s)) {
    return { tier: "MEDIUM", min: 100 };
  }
  return { tier: "SMALL", min: 50 };
}

function pickPrice(z) {
  const candidates = [
    { k: "currentPrice", v: z?.currentPrice },
    { k: "salePrice", v: z?.salePrice },
    { k: "regularPrice", v: z?.regularPrice },
    { k: "listPrice", v: z?.listPrice },
    { k: "price", v: z?.price },
  ]
    .filter((c) => c.v != null)
    .map((c) => ({ k: c.k, n: normalizeNumber(c.v) }))
    .filter((c) => isFinite(c.n) && c.n > 0);

  if (!candidates.length) return null;

  const priority = ["currentPrice", "salePrice", "regularPrice", "listPrice", "price"];
  const byPriority = (a, b) => priority.indexOf(a.k) - priority.indexOf(b.k);

  // Get tier requirements
  const { tier, min } = detectTier(z);

  // Try priority order first
  let best = [...candidates].sort(byPriority)[0];

  if (best.n < min) {
    // Scan for any valid price that meets tier requirement
    const alt = [...candidates].filter((c) => c.n >= min).sort(byPriority)[0];
    if (alt) best = alt;
    else {
      // No valid price found for this tier
      return { k: null, n: null, tier, min, unsure: true };
    }
  }

  return { ...best, tier, min, unsure: false };
}

function isGoodImage(im) {
  if (!im) return false;
  const url = typeof im === "string" ? im : im.url;
  if (!url) return false;
  if (/sprite|placeholder|blank|transparent/.test(url)) return false;
  const w = im?.width ?? 0;
  const h = im?.height ?? 0;
  return (w >= 600 && h >= 600) || (w === 0 && h === 0); // accept if dims unknown
}

function size(im) {
  return (im?.width || 0) * (im?.height || 0);
}

function pickImage(z, selectedVariantText) {
  const hero = z?.mainImage || z?.heroImage || z?.primary_image;
  if (isGoodImage(hero)) return { url: hero.url || hero, reason: "hero" };

  const images = Array.isArray(z?.images) ? z.images : [];
  if (selectedVariantText && images.length) {
    const txt = String(selectedVariantText).toLowerCase();
    const match = images.find((im) =>
      String(im.alt || im.title || im.url || "").toLowerCase().includes(txt)
    );
    if (isGoodImage(match)) return { url: match.url || match, reason: "variant" };
  }

  const largest = images.filter(isGoodImage).sort((a, b) => size(b) - size(a))[0];
  if (largest) return { url: largest.url || largest, reason: "largest" };

  return { url: null, reason: "none" };
}

// GET /products?url=...
app.get("/products", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: "MISSING_URL" });

  let product = null;
  let engine = "none";
  let confidence = null;

  try {
    // 1) Primary: Zyte
    if (USE_ZYTE) {
      try {
        const zyteData = await zyte.scrapeProduct(targetUrl);
        if (zyteData && zyteData.name) {
          // price selection + sanity
          const pricePick = pickPrice(zyteData);
          if (pricePick && !pricePick.unsure) {
            zyteData.price = pricePick.n;
            zyteData.priceSource = pricePick.k;
            zyteData.priceTier = pricePick.tier;
            console.log(
              `Selected price: $${zyteData.price} (source: ${pricePick.k}, tier: ${pricePick.tier}, min: $${pricePick.min})`
            );
          } else if (pricePick && pricePick.unsure) {
            zyteData.price = undefined;
            zyteData.engineNote = "price_unsure";
            zyteData.priceTier = pricePick.tier;
            console.log("Selected price: none (price_unsure)");
          }

          // image selection
          const pic = pickImage(zyteData, zyteData.variant || zyteData.primaryVariant);
          zyteData.image = pic.url || zyteData.image || null;
          console.log(`Selected image: ${zyteData.image || "none"} (reason: ${pic.reason})`);

          product = zyteData;
          engine = "Zyte";
          confidence = zyteData.confidence ?? null;
        }
      } catch (e) {
        console.log(`Zyte failed: ${e.message}`);
      }
    }

    // 2) Enrich with GPT only if needed (no price, low confidence, or marked unsure)
    const zyteSane =
      product &&
      product.price != null &&
      product.engineNote !== "price_unsure" &&
      (confidence == null || confidence >= 0.9);

    let triedGPT = false;
    if (!zyteSane && USE_GPT) {
      triedGPT = true;
      try {
        const enriched = await parseWithGPT(targetUrl, product || {});
        if (enriched) {
          // prefer filled fields
          product = { ...(product || {}), ...enriched };
          engine = product && engine === "Zyte" ? "GPT-enriched" : "GPT-only";
        }
      } catch (err) {
        // Don’t crash on 401 / missing key — just continue with Zyte
        console.log(`GPT enhancement skipped/failed: ${err.message}`);
      }
    }

    // 3) Fallback: GPT-only if we still have nothing
    if (!product && !triedGPT && USE_GPT) {
      try {
        product = await parseWithGPT(targetUrl);
        engine = "GPT-only";
      } catch (err) {
        console.log(`GPT-only failed: ${err.message}`);
      }
    }

    if (!product) return res.status(502).json({ error: "SCRAPE_FAILED" });

    // Response
    console.log(`Handled by: ${engine}`);
    return res.json({ products: product, engine });
  } catch (err) {
    console.error("UNEXPECTED:", err);
    return res.status(500).json({ error: "UNEXPECTED", message: String(err) });
  }
});

// POST /api/scrape - Frontend expects this endpoint
app.post("/api/scrape", async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "MISSING_URLS", message: "Please provide an array of URLs" });
  }

  console.log(`📦 Processing ${urls.length} URLs for scraping...`);
  const results = [];
  
  for (const url of urls) {
    console.log(`🔍 Processing: ${url}`);
    try {
      let product = null;
      let engine = "none";
      let confidence = null;

      // 1) Primary: Zyte
      if (USE_ZYTE) {
        try {
          console.log(`   🕷️ Trying Zyte for: ${url}`);
          const zyteData = await zyte.scrapeProduct(url);
          if (zyteData && zyteData.name) {
            // price selection + sanity
            const pricePick = pickPrice(zyteData);
            if (pricePick && !pricePick.unsure) {
              zyteData.price = pricePick.n;
              zyteData.priceSource = pricePick.k;
              zyteData.priceTier = pricePick.tier;
              console.log(
                `Selected price: $${zyteData.price} (source: ${pricePick.k}, tier: ${pricePick.tier}, min: $${pricePick.min})`
              );
            } else if (pricePick && pricePick.unsure) {
              zyteData.price = undefined;
              zyteData.engineNote = "price_unsure";
              zyteData.priceTier = pricePick.tier;
              console.log("Selected price: none (price_unsure)");
            }

            // image selection
            const pic = pickImage(zyteData, zyteData.variant || zyteData.primaryVariant);
            zyteData.image = pic.url || zyteData.image || null;
            console.log(`Selected image: ${zyteData.image || "none"} (reason: ${pic.reason})`);

            product = zyteData;
            engine = "Zyte";
            confidence = zyteData.confidence ?? null;
            console.log(`   ✅ Zyte success for: ${url}`);
          }
        } catch (e) {
          console.log(`   ❌ Zyte failed for ${url}: ${e.message}`);
        }
      }

      // 2) Enrich with GPT only if needed
      const zyteSane =
        product &&
        product.price != null &&
        product.engineNote !== "price_unsure" &&
        (confidence == null || confidence >= 0.9);

      let triedGPT = false;
      if (!zyteSane && USE_GPT) {
        triedGPT = true;
        console.log(`   🤖 Trying GPT enhancement for: ${url}`);
        try {
          const enriched = await parseWithGPT(url, product || {});
          if (enriched) {
            product = { ...(product || {}), ...enriched };
            engine = product && engine === "Zyte" ? "GPT-enriched" : "GPT-only";
            console.log(`   ✅ GPT enhancement success for: ${url}`);
          }
        } catch (err) {
          console.log(`   ❌ GPT enhancement failed for ${url}: ${err.message}`);
        }
      }

      // 3) Fallback: GPT-only if we still have nothing
      if (!product && !triedGPT && USE_GPT) {
        console.log(`   🤖 Trying GPT-only for: ${url}`);
        try {
          product = await parseWithGPT(url);
          engine = "GPT-only";
          console.log(`   ✅ GPT-only success for: ${url}`);
        } catch (err) {
          console.log(`   ❌ GPT-only failed for ${url}: ${err.message}`);
        }
      }

      if (product) {
        // Add retailer detection
        product.retailer = detectRetailer(url);
        product.url = url;
        product.engine = engine;
        results.push(product);
        console.log(`✅ Successfully scraped: ${url} (${engine})`);
      } else {
        console.log(`❌ Failed to scrape: ${url}`);
        results.push({
          url,
          error: "SCRAPE_FAILED",
          retailer: detectRetailer(url),
          message: "No data extracted from any scraping method"
        });
      }
    } catch (err) {
      console.error(`Error processing ${url}:`, err);
      results.push({
        url,
        error: "UNEXPECTED",
        message: String(err),
        retailer: detectRetailer(url)
      });
    }
  }

  console.log(`📊 Scraping complete: ${results.length} total, ${results.filter(p => !p.error).length} successful`);
  
  return res.json({ 
    success: true,
    products: results,
    total: results.length,
    successful: results.filter(p => !p.error).length
  });
});

// Helper function to detect retailer from URL
function detectRetailer(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('amazon')) return 'Amazon';
    if (hostname.includes('wayfair')) return 'Wayfair';
    if (hostname.includes('target')) return 'Target';
    if (hostname.includes('walmart')) return 'Walmart';
    if (hostname.includes('ikea')) return 'IKEA';
    if (hostname.includes('homedepot')) return 'Home Depot';
    if (hostname.includes('lowes')) return 'Lowes';
    if (hostname.includes('crateandbarrel')) return 'Crate & Barrel';
    if (hostname.includes('cb2')) return 'CB2';
    if (hostname.includes('westelm')) return 'West Elm';
    if (hostname.includes('potterybarn')) return 'Pottery Barn';
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ========= 404 handler that still serves SPA if needed =========
// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, "../frontend")));

// Catch-all handler for SPA routing (must be LAST)
app.get("*", (req, res) => {
  // If it looks like a file extension, return 404
  const looksLikeFile = /\.[a-z0-9]+$/i.test(req.path);
  if (looksLikeFile) {
    return res.status(404).send("Not Found");
  }
  
  // Otherwise serve index.html for SPA routes
  try {
    return res.sendFile(path.join(__dirname, "../frontend/index.html"));
  } catch (error) {
    return res.status(404).send("Not Found");
  }
});

// ========= Start =========
app.listen(PORT, () => {
  console.log("Starting Container");
  console.log("🕷️ ZyteScraper Constructor:");
  console.log(`   API Key: ${USE_ZYTE ? "✅ SET" : "❌ MISSING"}`);
  console.log(`   Status: ${USE_ZYTE ? "✅ ENABLED (v4.0 - Fixed Price Parsing)" : "❌ DISABLED"}`);
  console.log("   🎯 Ready to use Zyte API with automatic product extraction and smart price parsing");
  console.log(`🚀 SDL Import Calculator running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/ping`);
});
