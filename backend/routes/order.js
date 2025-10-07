const express = require('express');
const router = express.Router();
const { computeFreight, computePricing } = require('../utils/pricing');
const { estimateCarton } = require('../utils/cartonEstimator');
const { createDraftOrder } = require('../integrations/shopify');

router.post('/create', async (req, res) => {
  try {
    const { items = [], customer = {}, currency = 'USD' } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: 'No items provided' });
    }

    const line_items = [];

    for (const it of items) {
      const productInput = {
        retailer: it.retailer || '',
        sku: it.sku || '',
        name: it.name || '',
        price: Number(it.price || 0),
        profile: it.profile || 'default',
        vendorTier: it.vendorTier || 'neutral',
        assembled: it.assembled || null,
        carton: it.carton || null,
        description: it.description || ''
      };

      const est = estimateCarton(productInput);
      const freightRes = computeFreight({ cubicFeet: Number(est?.cubic_feet || 0) });
      const pricing = computePricing({
        itemPriceUSD: Number(it.price || 0),
        cubicFeet: Number(est?.cubic_feet || 0),
        dutyRatePct: it.dutyRatePct || 25,
      });

      const retailEach = Number(pricing?.totals?.retail || 0);

      line_items.push({
        title: it.name || it.sku || 'Custom item',
        quantity: Number(it.qty || 1),
        original_unit_price: retailEach.toFixed(2),
        properties: [
          { name: "RetailPerUnit", value: retailEach.toFixed(2) },
          { name: "Freight", value: (freightRes.freight || 0).toFixed(2) },
          { name: "CubicFeet", value: (est.cubic_feet || 0).toString() },
          { name: "EstimateSource", value: est.source },
          { name: "Confidence", value: (est.confidence ?? 0).toString() },
          { name: "Duty", value: (pricing.breakdown.duty || 0).toFixed(2) },
          { name: "NJTax", value: (pricing.breakdown.njTax || 0).toFixed(2) },
          { name: "FixedFees", value: (pricing.breakdown.fixedFees || 0).toFixed(2) },
          { name: "Landed", value: (pricing.breakdown.landed || 0).toFixed(2) },
          { name: "MarginAmt", value: (pricing.breakdown.marginAmt || 0).toFixed(2) },
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

    console.log(`✅ Draft Order created: ${draft?.id}`);

    return res.json({
      ok: true,
      draftOrderId: draft?.id,
      invoiceUrl,
      adminUrl
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
