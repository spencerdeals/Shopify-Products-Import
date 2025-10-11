function round2(n){ return Math.round((Number(n)||0)*100)/100; }

const CARD_FEE_RATE   = Number(process.env.CARD_FEE_RATE ?? 0.035);
const MARGIN_PCT      = Number(process.env.MARGIN_PCT ?? 0.25);
const APPLY_NJ_TAX    = (process.env.APPLY_NJ_TAX ?? 'true') === 'true';
const NJ_TAX_RATE_PCT = Number(process.env.NJ_TAX_RATE_PCT ?? 6.0);

// ---- Duty & Wharfage (Global) -------------------------------------------
const DUTY_PCT = 0.25;       // 25% duty
const WHARFAGE_PCT = 0.015;  // 1.5% wharfage
const DUTY_WHARFAGE_PCT = DUTY_PCT + WHARFAGE_PCT; // 0.265 (26.5%)

/**
 * Computes Duty + Wharfage on CIF base.
 * CIF base := itemUSD + usDeliveryUSD + bermudaFreightUSD
 *  - bermudaFreightUSD must exclude card fees and margin.
 */
function computeDutyWharfage({ itemUSD, usDeliveryUSD = 0, bermudaFreightUSD = 0 }) {
  const cif = (Number(itemUSD) || 0) + (Number(usDeliveryUSD) || 0) + (Number(bermudaFreightUSD) || 0);
  return round2(cif * DUTY_WHARFAGE_PCT);
}

function computeTotalsV41({ item=0, duty=0, freight=0 }) {
  const base = round2(item + duty + freight);
  const cardFee = round2(base * CARD_FEE_RATE);
  const landedAfterCard = round2(base + cardFee);
  const marginAmt = round2(landedAfterCard * MARGIN_PCT);

  const shippingHandling = round2(freight + cardFee + marginAmt);

  const retailBeforeTax = round2(item + duty + shippingHandling);

  const njSalesTax = APPLY_NJ_TAX
    ? round2(retailBeforeTax * (NJ_TAX_RATE_PCT/100))
    : 0;

  const finalRetail = round2(retailBeforeTax + njSalesTax);

  return {
    inputs: {
      item: round2(item),
      duty: round2(duty),
      freight: round2(freight)
    },
    cardFee,
    marginAmt,
    shippingHandling,
    retailBeforeTax,
    njSalesTax,
    finalRetail,
    meta: {
      cardFeeRate: CARD_FEE_RATE,
      marginPct: MARGIN_PCT,
      applyNjTax: APPLY_NJ_TAX,
      njTaxRatePct: NJ_TAX_RATE_PCT
    }
  };
}

module.exports = { computeTotalsV41, computeDutyWharfage, DUTY_WHARFAGE_PCT };
