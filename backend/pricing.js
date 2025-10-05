// backend/pricing.js
// Central pricing constants (with backward-compatible aliases)

const FREIGHT_RATE_PER_CUFT = 8.50;            // $/ft³
const SHIPPING_RATE_PER_CUBIC_FOOT = 8.50;     // alias for older code
const CUSTOMS_CLEAR_FEE_PER_VENDOR = 10;       // $/vendor

// Margin = 20% of TOTAL LANDED COST
const MARGIN_RATE = 0.20;
const MARGIN_RATE_OF_LANDED = 0.20;            // alias

// Card fee = 4% AFTER margin
const CARD_FEE_RATE = 0.04;

// If any old code references a base handling fee, keep it zero here
const DEFAULT_HANDLING_FEE = 0;

module.exports = {
  FREIGHT_RATE_PER_CUFT,
  SHIPPING_RATE_PER_CUBIC_FOOT,
  CUSTOMS_CLEAR_FEE_PER_VENDOR,
  MARGIN_RATE,
  MARGIN_RATE_OF_LANDED,
  CARD_FEE_RATE,
  DEFAULT_HANDLING_FEE,
};
