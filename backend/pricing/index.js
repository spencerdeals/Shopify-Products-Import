const { estimateDuty } = require('./estimateDuty');

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
  estimateDuty
};
