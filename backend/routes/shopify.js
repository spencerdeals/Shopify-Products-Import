const express = require("express");
const router = express.Router();

// Read multiple env names just in case
const STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.SHOPIFY_STORE ||
  process.env.SHOPIFY_DOMAIN ||
  process.env.SHOP_URL;

const ACCESS_TOKEN =
  process.env.SHOPIFY_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_TOKEN ||
  process.env.SHOPIFY_API_PASSWORD;

const API_VERSION = "2024-10";

// Use global fetch (Node 18+); if missing, try undici
let fetchFn = global.fetch;
(async () => {
  if (!fetchFn) {
    try {
      const { fetch } = await import("undici");
      fetchFn = fetch;
      console.log("[Shopify] Using undici fetch polyfill.");
    } catch (e) {
      console.warn("[Shopify] No fetch() available and undici not installed.");
    }
  }
})();

function toMoneyStr(n) {
  const x = typeof n === "string" ? Number(n) : n;
  return (isFinite(x) ? x : 0).toFixed(2);
}

// Helper to call Shopify API with proper error handling
async function shopifyAPI(path, options = {}) {
  if (!fetchFn) {
    throw new Error("No fetch() available");
  }

  const url = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}${path}`;
  const resp = await fetchFn(url, {
    method: options.method || "GET",
    headers: {
      "X-Shopify-Access-Token": ACCESS_TOKEN,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`[Shopify API Error] ${path}`, {
      status: resp.status,
      statusText: resp.statusText,
      body: text
    });
    throw new Error(`Shopify ${path} ${resp.status}: ${text}`);
  }

  return resp.json();
}

// Poll until invoice_url exists (after send_invoice)
async function waitForInvoiceUrl(draftOrderId, { attempts = 6, delayMs = 800 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const data = await shopifyAPI(`/draft_orders/${draftOrderId}.json`);
    const url = data?.draft_order?.invoice_url;
    if (url) {
      console.log(`[Shopify] Got invoice_url after ${i + 1} attempt(s)`);
      return url;
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

// Build Shopify draft line items from our product payload
function toShopifyLineItem(p, idx) {
  const qty = Math.max(1, parseInt(p.quantity || 1, 10));
  const unitPrice = Number(p.price) || 0;

  const li = {
    title: p.title || p.name || `Item ${idx + 1}`,
    price: toMoneyStr(unitPrice),
    quantity: qty
  };

  if (p.properties && Array.isArray(p.properties)) {
    li.properties = p.properties;
  } else if (p.url) {
    li.properties = [{ name: "Source URL", value: String(p.url) }];
  }

  return li;
}

// ---- DIAG
router.get("/diag", (_req, res) => {
  res.json({
    ok: true,
    hasDomain: Boolean(STORE_DOMAIN),
    hasToken: Boolean(ACCESS_TOKEN)
  });
});

// ---- CREATE ORDER (used by the form)
router.post("/create-order", async (req, res) => {
  try {
    if (!STORE_DOMAIN || !ACCESS_TOKEN) {
      console.error("[Shopify] Missing envs. Domain:", STORE_DOMAIN, "Token:", !!ACCESS_TOKEN);
      return res.status(500).json({ error: "Shopify credentials not configured on server." });
    }

    const { customerEmail, items, shippingLines } = req.body || {};
    console.log("[Shopify] /create-order request body:", JSON.stringify(req.body, null, 2));

    if (!Array.isArray(items) || items.length === 0) {
      console.error("[Shopify] Invalid items:", { hasItems: !!items, isArray: Array.isArray(items), length: items?.length });
      return res.status(400).json({ error: "No items provided." });
    }

    // Validate each item has required fields
    const invalidItems = items.filter((it, idx) => {
      const hasTitle = !!(it.title || it.name);
      const price = Number(it.price);
      const hasPrice = Number.isFinite(price) && price > 0;
      if (!hasTitle || !hasPrice) {
        console.error(`[Shopify] Invalid item at index ${idx}:`, {
          hasTitle,
          hasPrice,
          rawPrice: it.price,
          parsedPrice: price,
          item: it
        });
        return true;
      }
      return false;
    });

    if (invalidItems.length > 0) {
      console.error('[Shopify] Invalid items details:', invalidItems);
      return res.status(400).json({
        error: `${invalidItems.length} item(s) have invalid data (missing title or price)`,
        invalidItems: invalidItems.map((it, idx) => ({
          index: idx,
          title: it.title || it.name,
          price: it.price
        }))
      });
    }

    const line_items = items.map((it, idx) => toShopifyLineItem(it, idx));
    console.log("[Shopify] Mapped line items:", JSON.stringify(line_items, null, 2));

    // Add shipping as a custom line item if provided
    console.log("[Shopify] Raw shippingLines received:", JSON.stringify(shippingLines, null, 2));
    if (Array.isArray(shippingLines) && shippingLines.length > 0) {
      const totalShipping = shippingLines.reduce((sum, sl) => sum + (Number(sl.price) || 0), 0);
      const shippingTitle = shippingLines.map(sl => sl.title).join(', ');

      line_items.push({
        title: shippingTitle,
        price: toMoneyStr(totalShipping),
        quantity: 1,
        properties: [{ name: "_shipping", value: "true" }]
      });
      console.log("[Shopify] Added shipping as line item:", shippingTitle, toMoneyStr(totalShipping));
    }

    // Extract URLs from properties array
    const productLinks = items.map((it, i) => {
      const urlProp = it.properties?.find(p => p.name === 'Product URL');
      const retailerProp = it.properties?.find(p => p.name === 'Retailer');
      const url = urlProp?.value || it.url;
      const retailer = retailerProp?.value || it.retailer || '';

      if (url) {
        return `${i + 1}. ${it.title || it.name || "Item"}\n   Retailer: ${retailer}\n   Link: ${url}`;
      }
      return null;
    }).filter(Boolean).join("\n\n");

    const payload = {
      draft_order: {
        line_items,
        note: productLinks ? `PRODUCT LINKS - Use these to purchase items:\n\n${productLinks}` : "No product links provided.",
        note_attributes: items
          .map((it, i) => {
            const urlProp = it.properties?.find(p => p.name === 'Product URL');
            const url = urlProp?.value || it.url;
            return url ? { name: `Item ${i + 1} URL`, value: String(url) } : null;
          })
          .filter(Boolean),
        email: (customerEmail || "").trim() || undefined,
        use_customer_default_address: true,
        tags: "Instant Import"
      }
    };

    console.log("[Shopify] Creating draft order with", line_items.length, "items.");
    console.log("[Shopify] Full payload:", JSON.stringify(payload, null, 2));

    // 1) Create draft order
    const created = await shopifyAPI("/draft_orders.json", {
      method: "POST",
      body: payload
    });

    console.log("[Shopify] Draft order created successfully:", created?.draft_order?.id);

    const draft = created?.draft_order;
    if (!draft?.id) {
      throw new Error("Draft order creation returned no id");
    }

    console.log("[Shopify] Draft created:", draft.id);
    console.log("✅ Shopify draft order tagged: Instant Import");

    // 2) If invoice_url already present, great; else send invoice & poll for URL
    let invoiceUrl = draft.invoice_url;
    if (!invoiceUrl) {
      console.log("[Shopify] No invoice_url yet, triggering send_invoice...");

      // Trigger send_invoice (Shopify will generate a customer-facing invoice URL)
      try {
        await shopifyAPI(`/draft_orders/${draft.id}/send_invoice.json`, {
          method: "POST",
          body: {
            draft_order_invoice: {
              to: customerEmail || undefined,
              subject: "Your Order Invoice from SDL",
              custom_message: "Please review and complete your order."
            }
          }
        });
        console.log("[Shopify] send_invoice triggered");
      } catch (sendErr) {
        console.warn("[Shopify] send_invoice failed, will try polling anyway:", sendErr.message);
      }

      // Poll for the invoice_url
      invoiceUrl = await waitForInvoiceUrl(draft.id);
    }

    if (!invoiceUrl) {
      console.warn("[Shopify] Could not get invoice_url after polling");
      // As a last resort, expose the admin URL (not ideal for customers)
      return res.status(200).json({
        draftOrderId: draft.id,
        checkoutUrl: null,
        adminUrl: `https://${STORE_DOMAIN}/admin/draft_orders/${draft.id}`,
        error: "Could not generate customer invoice URL. Please use admin URL."
      });
    }

    // 3) Return customer-facing invoice URL
    console.log("[Shopify] Invoice URL:", invoiceUrl);
    return res.status(200).json({
      draftOrderId: draft.id,
      checkoutUrl: invoiceUrl
    });
  } catch (err) {
    console.error("[Shopify] /create-order exception:", err);
    return res.status(500).json({ error: err.message || "Server error creating draft order." });
  }
});

// ---- TEST ORDER ($1 line to verify Shopify wiring)
router.get("/test-order", async (_req, res) => {
  try {
    if (!STORE_DOMAIN || !ACCESS_TOKEN) {
      return res.status(500).json({ error: "Shopify credentials not configured on server." });
    }

    const payload = {
      draft_order: {
        line_items: [{ title: "SDL Test Item", price: "1.00", quantity: 1 }],
        note: "SDL connectivity test",
        use_customer_default_address: true,
        tags: "Instant Import"
      }
    };

    // Create draft order
    const created = await shopifyAPI("/draft_orders.json", {
      method: "POST",
      body: payload
    });

    const draft = created?.draft_order;
    if (!draft?.id) {
      throw new Error("Draft order creation returned no id");
    }

    // Try to get invoice_url (with send_invoice + poll if needed)
    let invoiceUrl = draft.invoice_url;
    if (!invoiceUrl) {
      try {
        await shopifyAPI(`/draft_orders/${draft.id}/send_invoice.json`, {
          method: "POST",
          body: { draft_order_invoice: {} }
        });
      } catch (sendErr) {
        console.warn("[Shopify] send_invoice failed:", sendErr.message);
      }
      invoiceUrl = await waitForInvoiceUrl(draft.id);
    }

    if (!invoiceUrl) {
      return res.status(200).json({
        draftOrderId: draft.id,
        checkoutUrl: null,
        adminUrl: `https://${STORE_DOMAIN}/admin/draft_orders/${draft.id}`,
        error: "Could not generate invoice URL"
      });
    }

    return res.json({ checkoutUrl: invoiceUrl, draftOrderId: draft.id });
  } catch (err) {
    console.error("[Shopify] /test-order exception:", err);
    return res.status(500).json({ error: err.message || "Server error creating test order." });
  }
});

module.exports = router;
