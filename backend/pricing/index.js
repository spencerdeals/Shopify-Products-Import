const { estimateDuty } = require('./estimateDuty');

// Pricing constants for shipping & handling calculations
const FREIGHT_RATE_PER_CUFT = 8.50;
const SHIPPING_RATE_PER_CUBIC_FOOT = 8.50;
const CUSTOMS_CLEAR_FEE_PER_VENDOR = 10;
const MARGIN_RATE = 0.20;
const MARGIN_RATE_OF_LANDED = 0.20;
const CARD_FEE_RATE = 0.04;
const DEFAULT_HANDLING_FEE = 0;

function calculatePricing(product) {
  const {
    price: itemUnitPrice = 0,
    category,
    name: title,
    brand,
    retailer: vendor,
    hsCode
  } = product;

  // Get dynamic duty rate
  const { dutyPct, source: dutySource } = estimateDuty({
    category,
    title,
    brand,
    vendor,
    hsCode
  });

  // Calculate duty amount on item price
  const dutyAmount = Math.round(itemUnitPrice * (dutyPct / 100) * 100) / 100;

  return {
    dutyPct,
    dutyAmount,
    dutySource
  };
}

module.exports = {
  calculatePricing,
  estimateDuty,
  FREIGHT_RATE_PER_CUFT,
  SHIPPING_RATE_PER_CUBIC_FOOT,
  CUSTOMS_CLEAR_FEE_PER_VENDOR,
  MARGIN_RATE,
  MARGIN_RATE_OF_LANDED,
  CARD_FEE_RATE,
  DEFAULT_HANDLING_FEE
};
