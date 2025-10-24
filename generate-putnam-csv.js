// generate-putnam-csv.js (CommonJS version) — CSV Enricher using Zyte
// Usage:
//   ZYTE_APIKEY=xxxxx node generate-putnam-csv.js "./shopify-products-*.csv"
// Output:
//   ./shopify-products-*_ENRICHED-READY.csv

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const Papa = require("papaparse");
const he = require("he");

const ZYTE_APIKEY = process.env.ZYTE_APIKEY;

// --- Utilities ---------------------------------------------------------------

function sanitizeHtml(html) {
  if (!html) return "";
  // remove <script>/<style>/<iframe> blocks
  html = html.replace(/<\s*(script|style|iframe)[\s\S]*?<\/\s*\1\s*>/gi, "");
  // strip on* attributes
  html = html.replace(/\son\w+="[^"]*"/gi, "");
  // allowlist small set of tags; remove others
  const allowed = /<\/?(p|br|strong|em|h2|h3|ul|ol|li|table|thead|tbody|tr|td|th|a)(\s+[^>]*)?>/gi;
  html = html
    .replace(/</g, "\u0001")
    .replace(/>/g, "\u0002")
    .replace(allowed, (m) => m.replace(/\u0001/g, "<").replace(/\u0002/g, ">"))
    .replace(/\u0001.*?\u0002/g, ""); // drop disallowed tags
  // enforce rel="nofollow" on links
  html = html.replace(/<a\b([^>]*?)>/gi, (m, attrs) => {
    if (/rel=/.test(attrs)) return `<a${attrs}>`;
    return `<a${attrs} rel="nofollow">`;
  });
  return html.trim();
}

function extractUrlFromBody(bodyHtml) {
  if (!bodyHtml) return "";
  const m = bodyHtml.match(/href="([^"]+)"/i);
  return m ? m[1] : "";
}

function buildHtml({ title, description, features = [], specifications = [], sourceUrl }) {
  const parts = [];
  if (title) parts.push(`<h2>${he.encode(title)}</h2>`);
  if (description) {
    const safe = sanitizeHtml(description);
    // If description is plain text, wrap it in <p>
    if (!/<\s*(p|ul|ol|table|h2|h3)/i.test(safe)) {
      parts.push(`<p>${he.encode(safe)}</p>`);
    } else {
      parts.push(safe);
    }
  }
  if (features.length) {
    const lis = features.slice(0, 12).map(f => `<li>${he.encode(String(f))}</li>`).join("");
    parts.push(`<h3>Features</h3><ul>${lis}</ul>`);
  }
  if (specifications.length) {
    const rows = specifications.slice(0, 15).map(s => {
      const name = he.encode(String(s.name || s.label || ""));
      const value = he.encode(String(s.value || ""));
      return `<tr><td>${name}</td><td>${value}</td></tr>`;
    }).join("");
    parts.push(`<h3>Specifications</h3><table>${rows}</table>`);
  }
  if (sourceUrl) {
    const domain = (() => {
      try { return new URL(sourceUrl).hostname.replace(/^www\./, ""); } catch { return "source"; }
    })();
    parts.push(`<p><small>Source: <a href="${he.encode(sourceUrl)}" target="_blank" rel="nofollow">${he.encode(domain)}</a></small></p>`);
  }
  return parts.join("\n");
}

function suggestTags({ title, vendor, type, zyteFeat = [], zyteAttrs = {} }) {
  const tags = new Set();

  function addToken(s) {
    if (!s) return;
    String(s)
      .split(/[\/,&|]/)
      .map(x => x.trim().toLowerCase())
      .filter(x => x && x.length <= 30)
      .forEach(x => tags.add(x));
  }

  function add(...arr) { arr.forEach(addToken); }

  add(title, vendor, type);

  // pull some obvious attrs if present
  Object.entries(zyteAttrs || {}).forEach(([k, v]) => add(k, v));
  (zyteFeat || []).slice(0, 12).forEach(addToken);

  const tl = String(title || "").toLowerCase();
  if (tl.includes("desk")) add("desk", "home office");
  if (tl.includes("standing")) add("standing desk", "adjustable desk", "ergonomic", "sit stand");
  if (tl.includes("outdoor")) add("outdoor", "patio", "all-weather");
  if (tl.includes("sofa") || tl.includes("sectional")) add("sofa", "living room");

  // reduce noise, cap to 10
  return Array.from(tags)
    .map(s => s.replace(/[^\w\s\-]/g, "").trim())
    .filter(Boolean)
    .slice(0, 10);
}

async function zyteExtract(url) {
  if (!ZYTE_APIKEY || !url) return null;
  const resp = await fetch("https://api.zyte.com/v1/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "ApiKey " + ZYTE_APIKEY
    },
    body: JSON.stringify({
      url,
      browserHtml: true,
      product: { extractFrom: ["auto"] },
      httpResponseBody: false
    })
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Zyte ${resp.status}: ${txt.slice(0,200)}`);
  }
  return await resp.json();
}

function pickProduct(z) {
  if (!z) return {};
  if (z.product) return z.product;
  if (Array.isArray(z.products) && z.products.length) return z.products[0];
  return {};
}

// --- Main --------------------------------------------------------------------

async function enrichCsv(inputPath) {
  const csvData = fs.readFileSync(inputPath, "utf8");
  const parsed = Papa.parse(csvData, { header: true });
  const rows = parsed.data.filter(r => Object.values(r).some(v => String(v || "").trim() !== ""));

  const out = [];
  let i = 0;

  for (const r of rows) {
    i += 1;
    let body = r["Body (HTML)"] || "";
    const title = r["Title"] || "";
    const vendor = r["Vendor"] || "";
    const type = r["Type"] || "";
    const existingTags = (r["Tags"] || "").split(",").map(s => s.trim()).filter(Boolean);

    // Decide if we need enrichment
    const bodyTooShort = body.replace(/\s+/g, " ").trim().length < 150 || /Source:\s*<a/i.test(body);
    let url = extractUrlFromBody(body);

    let zyteDescription = "";
    let zyteFeatures = [];
    let zyteSpecs = [];
    let zyteAttrs = {};

    if (bodyTooShort && url && ZYTE_APIKEY) {
      try {
        const z = await zyteExtract(url);
        const p = pickProduct(z);
        zyteDescription = p.descriptionHtml || p.description || p.descriptionText || "";
        zyteFeatures = p.features || p.bullets || [];
        zyteSpecs =
          p.specifications ||
          (p.attributes ? Object.entries(p.attributes).map(([name, value]) => ({ name, value })) : []);
        zyteAttrs = p.attributes || {};
        console.log(`✅ [${i}/${rows.length}] Enriched from Zyte`);
      } catch (e) {
        console.log(`⚠️  [${i}/${rows.length}] Zyte failed: ${e.message}`);
      }
    } else {
      console.log(`ℹ️  [${i}/${rows.length}] Skipped Zyte (not needed or missing URL/API key)`);
    }

    // Build Body (HTML)
    let finalBody = body;
    if (bodyTooShort) {
      const html = buildHtml({
        title,
        description: zyteDescription || `A ${title} from ${vendor || "our catalog"}.`,
        features: zyteFeatures,
        specifications: zyteSpecs,
        sourceUrl: url
      });
      finalBody = html || body;
    }

    // Build Tags (merge existing + generated)
    const genTags = suggestTags({ title, vendor, type, zyteFeat: zyteFeatures, zyteAttrs });
    const finalTags = Array.from(new Set([...existingTags, ...genTags])).slice(0, 10).join(", ");

    // Write back into row
    r["Body (HTML)"] = finalBody;
    r["Tags"] = finalTags;

    out.push(r);
  }

  const output = Papa.unparse(out, { quotes: true });
  const outPath = path.join(
    path.dirname(inputPath),
    path.basename(inputPath, ".csv") + "_ENRICHED-READY.csv"
  );
  fs.writeFileSync(outPath, output, "utf8");
  console.log(`\n✅ Wrote ${outPath}`);
  return outPath;
}

// CLI entry
if (require.main === module) {
  const input = process.argv[2] || "./shopify-products-DEMO-v3.csv";
  enrichCsv(input).catch(err => {
    console.error("❌ Enrichment failed:", err);
    process.exit(1);
  });
}

// Exportable for internal use (optional)
module.exports = { enrichCsv };
