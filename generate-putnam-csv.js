// generate-putnam-csv.js
import fs from "fs";
import Papa from "papaparse";

/**
 * Shopify CSV Export with Zyte description & tag enrichment
 * Works for any product processed through the admin calculator.
 */

export async function generateShopifyCsv(products, outputPath = "./exports/latest.csv") {
  console.log("🛠️  Starting Shopify CSV export with Zyte enrichment...");

  const rows = products.map((p) => {
    const zyte = p.zyteData || {};
    const product = zyte.product || {};
    const description =
      product.descriptionText ||
      product.description ||
      p.description ||
      "";

    // Prefer Zyte HTML if available
    const safeHtml = description
      ? `<p>${description}</p>`
      : `<p><small>Source: <a href="${p.url || ""}" rel="nofollow">Product page</a></small></p>`;

    // Build tags intelligently from available data
    const tagSet = new Set();
    const tagParts = [
      p.title,
      p.vendor,
      p.type,
      product.brand?.name,
      product.attributes?.color,
      product.attributes?.material,
      product.attributes?.style,
      product.attributes?.room,
      product.category,
    ]
      .filter(Boolean)
      .join(", ")
      .toLowerCase()
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && t.length < 30);

    tagParts.forEach((t) => tagSet.add(t));
    const tags = Array.from(tagSet).slice(0, 10).join(", ");

    return {
      Handle: p.handle || "",
      Title: p.title || "",
      Vendor: p.vendor || "Unknown",
      Type: p.type || "",
      Tags: tags,
      "Body (HTML)": safeHtml,
      "Variant Price": p.price || "",
      "Cost per item": p.cost || "",
      Collection: p.collection || "",
    };
  });

  const csv = Papa.unparse(rows, { quotes: true });
  fs.writeFileSync(outputPath, csv, "utf8");

  console.log(`✅ Shopify CSV written: ${outputPath}`);
  console.log(`🧾 Total rows: ${rows.length}`);
  return outputPath;
}

// If this file is run directly (not imported), load a test sample
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const samplePath = process.argv[2] || "./shopify-products-DEMO-v3.csv";
    const outputPath = "./exports/latest.csv";
    const data = Papa.parse(fs.readFileSync(samplePath, "utf8"), { header: true }).data;
    generateShopifyCsv(data, outputPath);
  } catch (err) {
    console.error("❌ Error running CSV generator:", err);
  }
}
