import 'dotenv/config';
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import Papa from "papaparse";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const PORT = process.env.PORT || 8080;

// --- ENV
const ZYTE_API_KEY = process.env.ZYTE_API_KEY || ""; // Primary (required)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ""; // Backup parser (optional)
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || ""; // optional for collections
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || ""; // optional for collections

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// --- Helpers
function ceilToFive(n) {
  const x = Math.ceil(Number(n) || 0);
  return Math.ceil(x / 5) * 5;
}
function slugify(text) {
  if (!text) return "";
  return text.toString().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}
function cleanPriceLike(str) {
  if (!str) return 0;
  const m = ("" + str).replace(/\s+/g," ").match(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/);
  if (!m) return 0;
  return Number(m[0].replace(/,/g, ""));
}
function cubicFeetFromInches(L, W, H) {
  const l = Number(L)||0, w = Number(W)||0, h = Number(H)||0;
  if (l<=0 || w<=0 || h<=0) return 0;
  return +( (l*w*h)/1728 ).toFixed(3);
}
function textTruncate(str, max = 110000) {
  if (!str) return "";
  if (str.length <= max) return str;
  const head = str.slice(0, Math.floor(max * 0.7));
  const tail = str.slice(-Math.floor(max * 0.3));
  return `${head}\n<!-- TRUNCATED -->\n${tail}`;
}

// --- Fetchers using Zyte product extraction
async function fetchViaZyte(url) {
  if (!ZYTE_API_KEY) throw new Error("Missing ZYTE_API_KEY");
  const endpoint = "https://api.zyte.com/v1/extract";

  // Use Zyte's automatic product extraction
  const resp = await axios.post(
    endpoint,
    {
      url,
      browserHtml: true,
      product: true,
      productOptions: {
        extractFrom: "browserHtml"
      }
    },
    { auth: { username: ZYTE_API_KEY, password: "" }, timeout: 60000 }
  );

  return resp.data;
}

async function fetchDirect(url) {
  const resp = await axios.get(url, {
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0 (SDL Importer; +https://sdl.bm)" }
  });
  return resp.data;
}

async function fetchProductData(url) {
  try {
    const zyteData = await fetchViaZyte(url);
    return { type: 'zyte', data: zyteData };
  }
  catch (err) {
    console.log('Zyte failed, trying direct:', err.message);
    const html = await fetchDirect(url);
    return { type: 'html', data: html };
  }
}

// --- Backup parsing with OpenAI
async function parseWithOpenAI({ url, html }) {
  if (!openai) return null;
  const system = `You are a product page parser. Extract JSON with keys: title (string), price (number), images (array of urls), vendor (string), body_html (short HTML), source_url (string). Never invent facts.`;
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: `URL:\n${url}\n\nHTML:\n${textTruncate(html)}` }
    ]
  });
  try {
    const json = JSON.parse(completion.choices[0].message.content || "{}");
    return {
      title: json.title || "",
      price: Number(json.price || 0),
      images: Array.isArray(json.images) ? json.images.filter(Boolean) : [],
      image: (Array.isArray(json.images) && json.images[0]) || "",
      vendor: json.vendor || "",
      body_html: json.body_html || "",
      source_url: json.source_url || url
    };
  } catch { return null; }
}

// --- Parsers
async function parseAmazon(url, html) {
  const $ = cheerio.load(html);
  const title = $("#productTitle").text().trim() || $('meta[property="og:title"]').attr("content") || "";
  const priceStr = $('span.a-price span.a-offscreen').first().text().trim() || $('span.a-offscreen').first().text().trim() || "";
  const price = cleanPriceLike(priceStr);
  const image =
    $("#imgTagWrapperId img#landingImage").attr("data-old-hires") ||
    $("#imgTagWrapperId img#landingImage").attr("src") ||
    $('img[data-a-image-name="landingImage"]').attr("src") ||
    $('meta[property="og:image"]').attr("content") || "";
  const byline = $("#bylineInfo").text().trim();
  const vendor = byline || "Amazon";
  const bullets = $("#feature-bullets li").map((_, el) => `<li>${$(el).text().trim()}</li>`).get().join("");
  const desc = bullets || $("#productDescription").text().trim() || $('meta[name="description"]').attr("content") || "";
  return { title, price, image, images: image ? [image] : [], vendor, body_html: bullets ? `<ul>${bullets}</ul>` : desc, source_url: url };
}
async function parseLuna(url, html) {
  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr("content") || $("h1").first().text().trim() || $("title").text().trim();
  const image = $('meta[property="og:image"]').attr("content") || $("img").first().attr("src") || "";
  const desc = $('meta[name="description"]').attr("content") || "";
  const priceSel = $('[class*="price"], .product-price, .price__current, .product__price').first().text().trim();
  const price = cleanPriceLike(priceSel);
  const vendor = "Luna Furniture";
  return { title: (title||"").trim(), price, image, images: image ? [image] : [], vendor, body_html: desc, source_url: url };
}
async function parseGeneric(url, html) {
  const $ = cheerio.load(html);
  const title = $('meta[property="og:title"]').attr("content") || $("h1").first().text().trim() || $("title").text().trim();
  const image = $('meta[property="og:image"]').attr("content") || $("img").first().attr("src") || "";
  const desc = $('meta[name="description"]').attr("content") || "";
  const bodyText = $("body").text();
  const priceMatch = bodyText.match(/\$[\s]*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  const price = priceMatch ? cleanPriceLike(priceMatch[0]) : 0;
  const vendor = $('meta[property="og:site_name"]').attr("content") || new URL(url).hostname;
  return { title: (title||"").trim(), price, image, images: image ? [image] : [], vendor, body_html: desc, source_url: url };
}
function pickParser(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host.includes("amazon.")) return parseAmazon;
  if (host.includes("lunafurniture")) return parseLuna;
  return parseGeneric;
}

// --- Collections
let cachedCollections = { custom: [], smart: [] };
async function fetchShopifyCollections() {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) return { custom: [], smart: [] };
  const base = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-07`;
  const headers = { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN };
  try {
    const [custom, smart] = await Promise.all([
      axios.get(`${base}/custom_collections.json?limit=250`, { headers }),
      axios.get(`${base}/smart_collections.json?limit=250`, { headers })
    ]);
    return { custom: custom.data.custom_collections || [], smart: smart.data.smart_collections || [] };
  } catch { return { custom: [], smart: [] }; }
}
app.get("/api/collections", async (_req, res) => {
  cachedCollections = await fetchShopifyCollections();
  res.json(cachedCollections);
});

// --- Category heuristics
const CATEGORY_KEYWORDS = [
  { cat: "Home & garden > Furniture > Sofas", kws: ["sofa","couch","loveseat","sectional"] },
  { cat: "Home & garden > Furniture > Beds & bed frames", kws: ["bed","platform bed","king","queen","full","twin"] },
  { cat: "Home & garden > Furniture > Mattresses", kws: ["mattress","memory foam","hybrid mattress"] },
  { cat: "Home & garden > Furniture > Tables > Coffee tables", kws: ["coffee table"] },
  { cat: "Home & garden > Furniture > Tables > Dining tables", kws: ["dining table"] },
  { cat: "Home & garden > Furniture > Chairs > Dining chairs", kws: ["dining chair"] },
  { cat: "Home & garden > Furniture > Storage & organization > Dressers", kws: ["dresser","chest"] },
  { cat: "Home & garden > Decor > Rugs", kws: ["rug","runner"] }
];
function guessProductCategory(title, body, tags=[]) {
  const hay = `${title} ${body} ${tags.join(" ")}`.toLowerCase();
  for (const {cat, kws} of CATEGORY_KEYWORDS) if (kws.some(k => hay.includes(k))) return cat;
  return "";
}
function autoCollections(title, vendor, tags=[]) {
  const guess = [];
  const hay = `${title} ${vendor} ${tags.join(" ")}`.toLowerCase();
  for (const c of [...(cachedCollections.custom||[]), ...(cachedCollections.smart||[])]) {
    const t = (c.title||"").toLowerCase();
    if (t && hay.includes(t)) guess.push(c.title);
  }
  return Array.from(new Set(guess)).slice(0, 3);
}

// --- CSV columns (adds dimension metas)
const CSV_HEADERS = [
  "Handle","Title","Body (HTML)","Vendor","Product Category","Type","Tags","Published",
  "Option1 Name","Option1 Value","Variant SKU","Variant Inventory Tracker","Variant Inventory Qty","Variant Inventory Policy","Variant Fulfillment Service",
  "Variant Price","Variant Compare At Price","Variant Requires Shipping","Variant Taxable","Variant Barcode",
  "Image Src","Image Position","Image Alt Text","SEO Title","SEO Description","Variant Image","Variant Weight Unit","Variant Tax Code","Cost per item","Status",
  "Meta: Source URL","Meta: Auto Collections",
  "Meta: Box Length (in)","Meta: Box Width (in)","Meta: Box Height (in)","Meta: Box Volume (ft3)"
];
function buildRow(p) {
  return {
    "Handle": p.handle,
    "Title": p.title,
    "Body (HTML)": p.body_html || "",
    "Vendor": p.vendor || "",
    "Product Category": p.product_category || "",
    "Type": p.type || "",
    "Tags": (p.tags||[]).join(", "),
    "Published": "TRUE",
    "Option1 Name": "Title",
    "Option1 Value": "Default Title",
    "Variant SKU": p.sku || "",
    "Variant Inventory Tracker": "",
    "Variant Inventory Qty": "",
    "Variant Inventory Policy": "deny",
    "Variant Fulfillment Service": "manual",
    "Variant Price": String(p.price_rounded || ""),
    "Variant Compare At Price": "",
    "Variant Requires Shipping": "TRUE",
    "Variant Taxable": "TRUE",
    "Variant Barcode": "",
    "Image Src": p.images?.[0] || p.image || "",
    "Image Position": "1",
    "Image Alt Text": p.title || "",
    "SEO Title": (p.title||"").slice(0, 70),
    "SEO Description": (p.seo_description||"").slice(0, 320),
    "Variant Image": p.images?.[0] || "",
    "Variant Weight Unit": "lb",
    "Variant Tax Code": "",
    "Cost per item": String(p.cost || ""),
    "Status": "active",
    "Meta: Source URL": p.source_url || "",
    "Meta: Auto Collections": (p.auto_collections||[]).join(" | "),
    "Meta: Box Length (in)": String(p.box_length_in || ""),
    "Meta: Box Width (in)": String(p.box_width_in || ""),
    "Meta: Box Height (in)": String(p.box_height_in || ""),
    "Meta: Box Volume (ft3)": String(p.box_volume_ft3 || "")
  };
}

// --- Pricing
function computeRetail(scrapedPrice, marginPct=45) {
  const base = Number(scrapedPrice || 0);
  const retailRaw = base * (1 + Number(marginPct)/100);
  return ceilToFive(retailRaw);
}

// --- Unified parse
async function parseProduct(url, productData) {
  // Handle Zyte product extraction data
  if (productData.type === 'zyte' && productData.data.product) {
    const product = productData.data.product;
    console.log('Using Zyte product extraction');

    // Extract price with priority for sale/current prices
    let price = 0;
    if (product.price) {
      if (typeof product.price === 'number') price = product.price;
      else if (typeof product.price === 'string') price = cleanPriceLike(product.price);
      else if (product.price.value) price = parseFloat(product.price.value);
    }

    // Fallback prices
    if (!price && product.currentPrice) price = typeof product.currentPrice === 'number' ? product.currentPrice : cleanPriceLike(product.currentPrice);
    if (!price && product.regularPrice) price = typeof product.regularPrice === 'number' ? product.regularPrice : cleanPriceLike(product.regularPrice);

    const title = product.name || "";
    const image = product.mainImage?.url || product.images?.[0]?.url || product.images?.[0] || "";
    const images = product.images ? product.images.map(img => typeof img === 'string' ? img : img.url).filter(Boolean) : (image ? [image] : []);
    const vendor = product.brand?.name || new URL(url).hostname;
    const body_html = product.description || "";

    return {
      title: (title || "").trim(),
      price,
      image,
      images,
      vendor,
      body_html,
      source_url: url
    };
  }

  // Fallback to HTML parsing
  const html = typeof productData.data === 'string' ? productData.data : '';
  const parser = pickParser(url);
  let parsed = await parser(url, html);
  const missingCore = !parsed?.title || (!parsed?.price && !parsed?.image);

  if (missingCore) {
    const ai = await parseWithOpenAI({ url, html });
    if (ai) {
      parsed = { ...parsed, ...ai, price: Number(ai.price || parsed.price || 0), images: ai.images?.length ? ai.images : parsed.images };
    }
  }

  parsed.price = Number(parsed.price || 0);
  if (!parsed.images || !parsed.images.length) parsed.images = parsed.image ? [parsed.image] : [];
  return parsed;
}

// --- API
app.post("/api/preview", async (req, res) => {
  try {
    const { urls = [], marginPercent = 45, overrides = {} } = req.body || {};
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: "Provide { urls: string[] }" });
    cachedCollections = await fetchShopifyCollections();

    const items = [];
    for (const url of urls) {
      try {
        const productData = await fetchProductData(url);
        const p = await parseProduct(url, productData);
        const handle = slugify(p.title || p.vendor || "item");

        const o = (overrides[handle] || {});
        const margin = Number(o.marginPercent ?? marginPercent);
        const cost = Number(o.cost ?? p.price ?? 0);

        const boxL = Number(o.box_length_in ?? "");
        const boxW = Number(o.box_width_in ?? "");
        const boxH = Number(o.box_height_in ?? "");
        const boxVol = cubicFeetFromInches(boxL, boxW, boxH);

        const priceRounded = computeRetail(cost, margin);
        const tags = Array.from(new Set([p.vendor, new URL(url).hostname].filter(Boolean)));
        const product_category = o.product_category || guessProductCategory(p.title, p.body_html, tags);
        const auto_collections = autoCollections(p.title, p.vendor, tags);

        items.push({
          ...p,
          handle,
          cost,
          price_rounded: priceRounded,
          margin_percent: margin,
          tags,
          product_category,
          auto_collections,
          box_length_in: boxL || "",
          box_width_in: boxW || "",
          box_height_in: boxH || "",
          box_volume_ft3: boxVol || ""
        });
      } catch (e) {
        items.push({
          title: "FAILED TO SCRAPE",
          vendor: "",
          price: 0,
          image: "",
          images: [],
          body_html: "",
          source_url: url,
          handle: slugify("failed-"+url),
          cost: 0,
          price_rounded: 0,
          margin_percent: Number(marginPercent),
          tags: [],
          product_category: "",
          auto_collections: [],
          box_length_in: "",
          box_width_in: "",
          box_height_in: "",
          box_volume_ft3: ""
        });
      }
    }

    res.json({
      items,
      columns: ["image","title","vendor","cost","margin_percent","price_rounded","box_length_in","box_width_in","box_height_in","box_volume_ft3","product_category","auto_collections","tags","handle","source_url"]
    });

  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
});

app.post("/api/build-csv", async (req, res) => {
  try {
    const { urls = [], marginPercent = 45, overrides = {} } = req.body || {};
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: "Provide { urls: string[] }" });
    cachedCollections = await fetchShopifyCollections();

    const rows = [];
    for (const url of urls) {
      try {
        const productData = await fetchProductData(url);
        const p = await parseProduct(url, productData);
        const handle = slugify(p.title || p.vendor || "item");

        const o = (overrides[handle] || {});
        const cost = Number(o.cost ?? p.price ?? 0);
        const margin = Number(o.marginPercent ?? marginPercent);

        const boxL = Number(o.box_length_in ?? "");
        const boxW = Number(o.box_width_in ?? "");
        const boxH = Number(o.box_height_in ?? "");
        const boxVol = cubicFeetFromInches(boxL, boxW, boxH);

        const product_category = o.product_category || guessProductCategory(p.title, p.body_html, []);
        const auto_collections = autoCollections(p.title, p.vendor, []);
        const price_rounded = computeRetail(cost, margin);

        const enriched = {
          ...p,
          handle,
          cost,
          product_category,
          auto_collections,
          price_rounded,
          type: o.type || "",
          tags: Array.from(new Set([(p.vendor || ""), (new URL(url)).hostname].filter(Boolean))),
          box_length_in: boxL || "",
          box_width_in: boxW || "",
          box_height_in: boxH || "",
          box_volume_ft3: boxVol || ""
        };

        rows.push(buildRow(enriched));

        if (Array.isArray(p.images) && p.images.length > 1) {
          p.images.slice(1).forEach((img, idx) => {
            rows.push({ "Handle": enriched.handle, "Image Src": img, "Image Position": String(idx + 2) });
          });
        }
      } catch {
        const handle = slugify("failed-"+url);
        rows.push({
          "Handle": handle, "Title": "FAILED TO SCRAPE", "Body (HTML)": "", "Vendor": "",
          "Product Category": "", "Type": "", "Tags": "", "Published": "TRUE",
          "Option1 Name": "Title", "Option1 Value": "Default Title", "Variant SKU": "",
          "Variant Inventory Tracker": "", "Variant Inventory Qty": "", "Variant Inventory Policy": "deny",
          "Variant Fulfillment Service": "manual", "Variant Price": "", "Variant Compare At Price": "",
          "Variant Requires Shipping": "TRUE", "Variant Taxable": "TRUE", "Variant Barcode": "",
          "Image Src": "", "Image Position": "1", "Image Alt Text": "",
          "SEO Title": "", "SEO Description": "", "Variant Image": "", "Variant Weight Unit": "lb",
          "Variant Tax Code": "", "Cost per item": "", "Status": "active",
          "Meta: Source URL": url, "Meta: Auto Collections": "",
          "Meta: Box Length (in)": "", "Meta: Box Width (in)": "", "Meta: Box Height (in)": "", "Meta: Box Volume (ft3)": ""
        });
      }
    }

    const csv = Papa.unparse({
      fields: CSV_HEADERS,
      data: rows.map(r => CSV_HEADERS.map(h => r[h] ?? ""))
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=sdl_shopify_import.csv");
    res.status(200).send(csv);

  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// --- Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`SDL Shopify Importer running on ${PORT}`);
});
