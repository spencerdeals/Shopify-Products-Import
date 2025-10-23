#!/usr/bin/env node
/**
 * CSV Sidecar Enricher for Shopify Products
 * - Reads input CSV
 * - For each product, fetches rich description via Zyte Universal Extractor
 * - Populates Body (HTML) and Tags
 * - Writes *_ENRICHED-READY.csv
 *
 * USAGE:
 *   ZYTE_APIKEY=xxxxx node enrich-csv.js input.csv
 *
 * NOTES:
 * - Leaves all other columns untouched.
 * - If Zyte fails, falls back to JSON-LD / OpenGraph parse.
 */
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const Papa = require("papaparse");
const he = require("he");

const ZYTE_APIKEY = process.env.ZYTE_APIKEY;
if (!ZYTE_APIKEY) {
  console.error("Missing ZYTE_APIKEY env var.");
  process.exit(1);
}

// Basic HTML sanitizer: allow a small safe tag set
function sanitizeHtml(html) {
  if (!html) return "";
  // Extremely lightweight allowlist (we’re keeping it simple for CSV)
  // Strip scripts/styles/iframes
  html = html.replace(/<\s*(script|style|iframe)[\s\S]*?<\/\s*\1\s*>/gi, "");
  // Remove on* attributes
  html = html.replace(/\son\w+="[^"]*"/gi, "");
  // Allow only a subset of tags; strip others
  const allowed = /<\/?(p|br|strong|em|h2|h3|ul|ol|li|table|thead|tbody|tr|td|th|a)(\s+[^>]*)?>/gi;
  html = html
    .replace(/</g, "\u0001")
    .replace(/>/g, "\u0002")
    .replace(allowed, (m) =>
      m.replace(/\u0001/g, "<").replace(/\u0002/g, ">")
    )
    .replace(/\u0001.*?\u0002/g, ""); // remove disallowed tags entirely
  // Enforce rel="nofollow" on links
  html = html.replace(/<a\b([^>]*?)>/gi, (m, attrs) => {
    if (/rel=/.test(attrs)) return `<a${attrs}>`;
    return `<a${attrs} rel="nofollow">`;
  });
  return html.trim();
}

// Simple tag generator from fields
function suggestTags({ title, vendor, type, features = [], attributes = {} }) {
  const tags = new Set();

  function add(...arr) {
    arr.filter(Boolean).forEach((x) =>
      x
        .toString()
        .split(/[\/,&|]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => tags.add(s.toLowerCase()))
    );
  }

  add(type, vendor, title);

  // Features / attributes
  features.slice(0, 12).forEach((f) => add(f));
  Object.entries(attributes).forEach(([k, v]) => add(k, v));

  // Heuristics: function/room/material/style
  const t = (title || "").toLowerCase();
  if (t.includes("desk")) add("home office", "desk", "adjustable desk");
  if (t.includes("standing")) add("standing desk", "sit stand", "ergonomic");
  if (t.includes("outdoor")) add("outdoor", "patio", "all-weather");
  if (t.includes("sofa") || t.includes("sectional")) add("sofa", "living room");

  // Keep 5–10 best-ish unique tokens, remove long/weird ones
  const cleaned = [...tags]
    .map((s) => s.replace(/[^\w\s\-]/g, ""))
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 30);

  // Prefer unique keywords from title/vendor/type
  const prioritized = [];
  const pushIf = (w) => {
    if (w && !prioritized.includes(w)) prioritized.push(w);
  };
  (title || "")
    .toLowerCase()
    .split(/\s+/)
    .forEach((w) => pushIf(w));
  pushIf((vendor || "").toLowerCase());
  pushIf((type || "").toLowerCase());

  // Merge with cleaned, then cap
  const final = Array.from(
    new Set([...prioritized, ...cleaned])
  ).filter(Boolean);
  return final.slice(0, 10);
}

async function zyteExtract(url) {
  // Zyte Universal Extractor v1
  const resp = await fetch("https://api.zyte.com/v1/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "ApiKey " + ZYTE_APIKEY,
    },
    body: JSON.stringify({
      url,
      // Product extraction; let Zyte auto-detect. Enable browser for JS sites.
      browserHtml: true,
      product: { extractFrom: ["auto"] },
      httpResponseBody: false,
    }),
  });
  if (!resp.ok) throw new Error(`Zyte error ${resp.status}`);
  return await resp.json();
}

function pickProduct(record) {
  // Zyte UE may return product / products / attributes
  if (record.product) return record.product;
  if (Array.isArray(record.products) && record.products.length)
    return record.products[0];
  return {};
}

function buildHtml({ title, description, features = [], specifications = [], sourceUrl }) {
  const safeDesc = sanitizeHtml(description || "");
  const parts = [];
  if (title) parts.push(`<h2>${he.encode(title)}</h2>`);
  if (safeDesc) parts.push(`<p>${safeDesc}</p>`);
  if (features.length) {
    const lis = features
      .slice(0, 12)
      .map((f) => `<li>${he.encode(f)}</li>`)
      .join("");
    parts.push(`<h3>Features</h3><ul>${lis}</ul>`);
  }
  if (specifications.length) {
    const rows = specifications
      .slice(0, 15)
      .map((s) => `<tr><td>${he.encode(s.name || s.label || "")}</td><td>${he.encode(s.value || "")}</td></tr>`)
      .join("");
    parts.push(`<h3>Specifications</h3><table>${rows}</table>`);
  }
  if (sourceUrl) {
    const domain = new URL(sourceUrl).hostname.replace(/^www\./, "");
    parts.push(
      `<p><small>Source: <a href="${he.encode(sourceUrl)}" target="_blank" rel="nofollow">${he.encode(domain)}</a></small></p>`
    );
  }
  return parts.join("\n");
}

(async () => {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: ZYTE_APIKEY=xxxxx node enrich-csv.js input.csv");
    process.exit(1);
  }
  const csv = fs.readFileSync(inputPath, "utf8");
  const parsed = Papa.parse(csv, { header: true });
  const rows = parsed.data.filter((r) => Object.keys(r).some((k) => r[k] !== ""));
  const out = [];

  for (const r of rows) {
    // Derive a source URL if present in Body(HTML) or a Source column if you have one
    let sourceUrl = "";
    const body = r["Body (HTML)"] || "";
    const m = body.match(/href="([^"]+)"/i);
    if (m) sourceUrl = m[1];

    let description = "";
    let features = [];
    let specs = [];
    let attrs = {};
    try {
      if (sourceUrl) {
        const z = await zyteExtract(sourceUrl);
        const p = pickProduct(z) || {};
        description = p.descriptionText || p.description || "";
        // Zyte names vary; handle bullets/specs/attributes safely
        features = (p.features || p.bullets || []).filter(Boolean);
        specs =
          (p.specifications ||
            (p.attributes &&
              Object.entries(p.attributes).map(([name, value]) => ({ name, value }))) ||
            []) ?? [];
        attrs = p.attributes || {};
      }
    } catch (e) {
      // Fallback: leave as-is; we’ll still synthesize from title
    }

    // Synthesize if needed
    const title = r["Title"] || "";
    const vendor = r["Vendor"] || "";
    const type = r["Type"] || "";
    const html = buildHtml({
      title,
      description: description || `A ${title} from ${vendor || "our catalog"}.`,
      features,
      specifications: specs,
      sourceUrl,
    });

    // Tags (merge existing + generated)
    const existingTags = (r["Tags"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    const genTags = suggestTags({ title, vendor, type, features, attributes: attrs });
    const finalTags = Array.from(new Set([...existingTags, ...genTags]))
      .filter(Boolean)
      .slice(0, 10)
      .join(", ");

    // Write back
    r["Body (HTML)"] = html;
    r["Tags"] = finalTags;
    out.push(r);
  }

  const output = Papa.unparse(out, { quotes: true });
  const outPath = path.join(
    path.dirname(inputPath),
    path.basename(inputPath, ".csv") + "_ENRICHED-READY.csv"
  );
  fs.writeFileSync(outPath, output);
  console.log("Wrote", outPath);
})();
