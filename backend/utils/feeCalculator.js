/**
 * Shipping & Handling calculator using pricing constants and final carton ft³.
 * Inputs:
 *  - cubicFeet: final carton cuft to charge freight on (use estimator's safe value)
 *  - landed: total landed cost base for margin (read from payload when available)
 *  - vendors: distinct vendor count (defaults to 1)
 * Constants come from backend/pricing.js
 */
let pricing;
try { pricing = require('../pricing'); }
catch (e) {
  console.warn("[feeCalculator] ../pricing not found, using emergency defaults");
  pricing = {
    FREIGHT_RATE_PER_CUFT: 8.50,
    SHIPPING_RATE_PER_CUBIC_FOOT: 8.50,
    CUSTOMS_CLEAR_FEE_PER_VENDOR: 10,
    MARGIN_RATE: 0.20,
    MARGIN_RATE_OF_LANDED: 0.20,
    CARD_FEE_RATE: 0.04,
    DEFAULT_HANDLING_FEE: 0,
  };
}

function toMoney(n) { return Number((n ?? 0).toFixed(2)); }

function computeShippingAndHandling({ cubicFeet = 0, landed = 0, vendors = 1 }) {
  const cuft = Math.max(0, Number(cubicFeet) || 0);
  const vndr = Math.max(1, Number(vendors) || 1);
  const landedBase = Math.max(0, Number(landed) || 0);

  const oceanBase = cuft * (pricing.FREIGHT_RATE_PER_CUFT ?? pricing.SHIPPING_RATE_PER_CUBIC_FOOT ?? 8.50);
  const ocean = Math.max(30, oceanBase);
  const customs = vndr * (pricing.CUSTOMS_CLEAR_FEE_PER_VENDOR ?? 10);

  // Margin: 20% of TOTAL LANDED COST (we read landedBase; do NOT alter the upstream logic)
  const marginRate = (pricing.MARGIN_RATE ?? pricing.MARGIN_RATE_OF_LANDED ?? 0.20);
  const margin = landedBase * marginRate;

  // Card fee: 4% AFTER margin, on the pre-card subtotal (landed + margin + ocean + customs)
  const preCard = landedBase + margin + ocean + customs;
  const cardFee = preCard * (pricing.CARD_FEE_RATE ?? 0.04);

  const total = ocean + customs + margin + cardFee;

  return {
    ocean_freight_usd: toMoney(ocean),
    customs_clear_fee_usd: toMoney(customs),
    margin_usd: toMoney(margin),
    card_fee_usd: toMoney(cardFee),
    total_usd: toMoney(total),
    _inputs: { cubicFeet: toMoney(cuft), vendors: vndr, landedBase: toMoney(landedBase) },
  };
}

module.exports = { computeShippingAndHandling };
