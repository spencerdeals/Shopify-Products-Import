const express = require('express');
const router = express.Router();
const { computePricing } = require('../../shared/pricing');
const { estimateCarton } = require('../utils/cartonEstimator');
const { createDraftOrder } = require('../integrations/shopify');
const { calcFreightSmart } = require('../lib/freightEngine');
const { saveScrape, saveQuote } = require('../utils/db');

router.post('/create', async (req, res) => {
  try {
    const { items = [], customer = {}, currency = 'USD' } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items provided' });
    }

    const line_items = [];
    let orderItemSubtotal = 0;
    let orderFreightTotal = 0;

    for (const it of items) {
      const itemPrice = Number(it.price || 0);
      const qty = Number(it.qty || 1);

      const productInput = {
        retailer: it.retailer || '',
        sku: it.sku || '',
        name: it.name || '',
        price: itemPrice,
        profile: it.profile || 'default',
        vendorTier: it.vendorTier || 'neutral',
        assembled: it.assembled || null,
        carton: it.carton || null,
        description: it.description || '',
        title: it.name || '',
        category: it.category || ''
      };

      const est = estimateCarton(productInput);

      const smartProduct = {
        ...productInput,
        cartonCubicFeet: Number(est.cubic_feet || 0)
      };
      const flog = {};
      const freightResult = calcFreightSmart(smartProduct, flog);
      const freightPerUnit = Number(freightResult.amount || 0);

      const pricing = computePricing({
        itemSubtotal: itemPrice,
        freight: freightPerUnit
      });

      orderItemSubtotal += itemPrice * qty;
      orderFreightTotal += freightPerUnit * qty;

      line_items.push({
        title: it.name || it.sku || 'Custom item',
        quantity: qty,
        original_unit_price: pricing.totals.totalLanded.toFixed(2),
        properties: [
          { name: "RetailPerUnit", value: pricing.totals.totalLanded.toFixed(2) },
          { name: "ItemPrice", value: itemPrice.toFixed(2) },
          { name: "Duty", value: pricing.breakdown.duty.toFixed(2) },
          { name: "Wharfage", value: pricing.breakdown.wharfage.toFixed(2) },
          { name: "Freight", value: freightPerUnit.toFixed(2) },
          { name: "ShippingHandling", value: pricing.breakdown.shippingAndHandling.toFixed(2) },
          { name: "NJTax", value: pricing.breakdown.njSalesTax.toFixed(2) },
          { name: "Margin", value: pricing.breakdown.margin.toFixed(2) },
          { name: "CubicFeet", value: (est.cubic_feet || 0).toString() },
          { name: "EstimateSource", value: est.source },
          { name: "Confidence", value: (est.confidence ?? 0).toString() },
          { name: "Retailer", value: it.retailer || '' },
          { name: "SKU", value: it.sku || '' }
        ]
      });
    }

    const draftPayload = {
      line_items,
      currency,
      tags: ["Bermuda Import Calculator"],
      note: "Created via calculator — per-line totals include freight, duty, tax, margin.",
      ...(customer && customer.email ? { customer: { email: customer.email } } : {})
    };

    const result = await createDraftOrder(draftPayload);
    const draft = result?.draft_order;
    const invoiceUrl = draft?.invoice_url || null;
    const adminUrl = draft ? `https://${process.env.SHOPIFY_SHOP}/admin/draft_orders/${draft.id}` : null;

    const orderPricing = computePricing({
      itemSubtotal: orderItemSubtotal,
      freight: orderFreightTotal
    });

    try {
      await saveQuote({
        customerEmail: customer?.email,
        items,
        pricing: orderPricing,
        draftId: draft?.id,
        invoiceUrl,
        source: 'instant-quote'
      });
    } catch (dbErr) {
      console.warn('⚠️  Failed to save quote to DB:', dbErr.message);
    }

    console.log(`✅ Draft Order created: ${draft?.id}`);

    return res.json({
      ok: true,
      draftOrderId: draft?.id,
      invoiceUrl,
      adminUrl,
      pricing: orderPricing
    });

  } catch (err) {
    console.error('❌ order/create error:', err.message);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err)
    });
  }
});

module.exports = router;
