function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const NJ_TAX_RATE = 0.06625;
const DUTY_RATE = 0.25;
const WHARFAGE_RATE = 0.015;
const MARGIN_RATE = 0.25;

function computePricing({
  itemSubtotal,
  freight,
  njTaxRate = NJ_TAX_RATE,
  dutyRate = DUTY_RATE,
  wharfageRate = WHARFAGE_RATE,
  marginRate = MARGIN_RATE
}) {
  const njSalesTax = round2(itemSubtotal * njTaxRate);

  const customsBase = round2(itemSubtotal + njSalesTax);
  const duty = round2(customsBase * dutyRate);
  const wharfage = round2(customsBase * wharfageRate);

  const marginBase = round2(itemSubtotal + freight);
  const margin = round2(marginBase * marginRate);

  const shippingAndHandling = round2(freight + margin + njSalesTax);

  const totalLanded = round2(itemSubtotal + shippingAndHandling + duty + wharfage);

  return {
    inputs: { itemSubtotal, freight, njTaxRate, dutyRate, wharfageRate, marginRate },
    breakdown: { njSalesTax, duty, wharfage, margin, shippingAndHandling },
    totals: { totalLanded, marginBase, customsBase }
  };
}

function computeItemCuftFallback(category) {
  if ((category || '').toLowerCase().includes('sofa')) return 45;
  return 11.33;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computePricing,
    computeItemCuftFallback,
    round2,
    NJ_TAX_RATE,
    DUTY_RATE,
    WHARFAGE_RATE,
    MARGIN_RATE
  };
}
