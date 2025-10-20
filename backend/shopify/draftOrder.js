/**
 * Shopify Draft Order Creator
 *
 * Creates Shopify draft orders from Torso product data.
 */

const axios = require('axios');
const torso = require('../torso');

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOPIFY_API_VERSION = '2024-10';

/**
 * Create a Shopify Draft Order
 */
async function createDraftOrder(handles, options = {}) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    throw new Error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_TOKEN environment variables');
  }

  console.log(`\n[Shopify] Creating draft order for ${handles.length} products`);

  // Build line items from Torso data
  const lineItems = [];

  for (const handle of handles) {
    const product = await torso.getProductComplete(handle);
    if (!product) {
      console.warn(`[Shopify] Product not found: ${handle}`);
      continue;
    }

    // Add each variant as a line item (default quantity 1)
    product.variants.forEach(variant => {
      if (!variant.pricing) {
        console.warn(`[Shopify] Variant ${variant.variant_sku} missing pricing`);
        return;
      }

      // Build title with options
      let title = product.title;
      if (variant.option1_value && variant.option1_value !== 'Default Title') {
        title += ` - ${variant.option1_value}`;
      }
      if (variant.option2_value) {
        title += ` / ${variant.option2_value}`;
      }

      lineItems.push({
        title,
        quantity: options.quantity || 1,
        price: variant.pricing.retail_price_usd.toString(),
        sku: variant.variant_sku,
        taxable: true,
        requires_shipping: true
      });
    });
  }

  if (lineItems.length === 0) {
    throw new Error('No valid line items found for draft order');
  }

  console.log(`[Shopify] Building draft order with ${lineItems.length} line items`);

  // Build draft order payload
  const payload = {
    draft_order: {
      line_items: lineItems,
      note: 'Created via SDL Instant Quote',
      use_customer_default_address: true,
      applied_discount: null,
      email: options.customerEmail || null,
      shipping_address: options.shippingAddress || null,
      billing_address: options.billingAddress || null
    }
  };

  // Create draft order via Shopify Admin API
  try {
    const response = await axios.post(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/draft_orders.json`,
      payload,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    const draftOrder = response.data.draft_order;

    console.log(`[Shopify] DRAFT_ORDER: id=${draftOrder.id}, name=${draftOrder.name}`);
    console.log(`[Shopify] Invoice URL: ${draftOrder.invoice_url}`);

    return {
      id: draftOrder.id,
      name: draftOrder.name,
      invoice_url: draftOrder.invoice_url,
      admin_url: `https://${SHOPIFY_STORE_DOMAIN}/admin/draft_orders/${draftOrder.id}`,
      total_price: draftOrder.total_price,
      line_items_count: lineItems.length
    };
  } catch (error) {
    console.error('[Shopify] Error creating draft order:', error.response?.data || error.message);

    // If error is because products don't exist in Shopify, throw helpful message
    if (error.response?.status === 422) {
      throw new Error('Products not found in Shopify. Please import the CSV first, then create draft order.');
    }

    throw new Error(`Shopify API error: ${error.response?.data?.errors || error.message}`);
  }
}

module.exports = {
  createDraftOrder
};
