// ---- Duty & Wharfage (Global) -------------------------------------------
const DUTY_PCT = 0.25;       // 25% duty
const WHARFAGE_PCT = 0.015;  // 1.5% wharfage
const DUTY_WHARFAGE_PCT = DUTY_PCT + WHARFAGE_PCT; // 0.265 (26.5%)

/**
 * Computes Duty + Wharfage on retail item price only.
 * Note: usDeliveryUSD and bermudaFreightUSD parameters are kept for API compatibility
 * but are not used in the calculation.
 */
function computeDutyWharfage({ itemUSD, usDeliveryUSD = 0, bermudaFreightUSD = 0 }) {
  return Math.round((Number(itemUSD) || 0) * DUTY_WHARFAGE_PCT * 100) / 100;
}

// Pricing constants for shipping & handling calculations
const FREIGHT_RATE_PER_CUFT = 8.50;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8.50;
const CUSTOMS_CLEAR_FEE_PER_VENDOR = 10;
const MARGIN_RATE = 0.25;
const MARGIN_RATE_OF_LANDED = 0.25;
const CARD_FEE_RATE = 0.04;
const DEFAULT_HANDLING_FEE = 0;

function calculatePricing(product) {
  const {
    price: itemUnitPrice = 0,
    usDelivery = 0,
    freight = 0
  } = product;

  // Fixed 26.5% duty+wharfage on CIF base
  const dutyAmount = computeDutyWharfage({
    itemUSD: itemUnitPrice,
    usDeliveryUSD: usDelivery,
    bermudaFreightUSD: freight
  });

  return {
    dutyPct: 26.5,
    dutyAmount,
    dutySource: 'fixed-cif'
  };
}

module.exports = {
  calculatePricing,
  computeDutyWharfage,
  DUTY_WHARFAGE_PCT,
  FREIGHT_RATE_PER_CUFT,
  SHIPPING_RATE_PER_CUBIC_FOOT,
  CUSTOMS_CLEAR_FEE_PER_VENDOR,
  MARGIN_RATE,
  MARGIN_RATE_OF_LANDED,
  CARD_FEE_RATE,
  DEFAULT_HANDLING_FEE
};
