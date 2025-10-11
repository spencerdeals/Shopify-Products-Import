// backend/utils/pricing.js
// Pure freight helper + (optional) pricing composer if you later want full landed totals.
// For the product card, use ONLY computeFreight().freight as "Est. shipping".

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// ---- Duty & Wharfage (Global) -------------------------------------------
const DUTY_PCT = 0.25;       // 25% duty
const WHARFAGE_PCT = 0.015;  // 1.5% wharfage

/**
 * Computes Duty (25%) on (item + NJ tax) base - NEVER includes freight
 * @param {number} itemUSD - Item price
 * @param {number} njTaxUSD - NJ sales tax amount
 * @param {number} dutyRate - Duty rate (default 0.25)
 */
function computeDuty({ itemUSD, njTaxUSD = 0, dutyRate = DUTY_PCT }) {
  const base = (Number(itemUSD) || 0) + (Number(njTaxUSD) || 0);
  return round2(base * dutyRate);
}

/**
 * Computes Wharfage (1.5%) on (item + NJ tax) base - NEVER includes freight
 * @param {number} itemUSD - Item price
 * @param {number} njTaxUSD - NJ sales tax amount
 * @param {number} wharfageRate - Wharfage rate (default 0.015)
 */
function computeWharfage({ itemUSD, njTaxUSD = 0, wharfageRate = WHARFAGE_PCT }) {
  const base = (Number(itemUSD) || 0) + (Number(njTaxUSD) || 0);
  return round2(base * wharfageRate);
}

/**
 * Compute pure freight from cubic feet with an environment-controlled rate and minimum.
 * If no cubic feet, falls back to percentage of price.
 * - cubicFeet: volume in ft³
 * - priceUSD: item price for fallback calculation
 * - fallbackPctOfPrice: percentage of price to use when no dimensions (default 0.5 = 50%)
 * - ratePerFt3: defaults to process.env.OCEAN_RATE_PER_FT3 || 8.5
 * - minFreightUSD: defaults to process.env.MIN_FREIGHT_USD || 30
 * Returns: { freight, inputs: { mode, cubicFeet, ratePerFt3, minFreightUSD, fallbackPctOfPrice } }
 */
function computeFreight(opts = {}) {
  const cf = Number(opts.cubicFeet || 0);
  const rate = Number(opts.ratePerFt3 ?? process.env.OCEAN_RATE_PER_FT3 ?? 8.5);
  const minF = Number(opts.minFreightUSD ?? process.env.MIN_FREIGHT_USD ?? 30);
  const priceUSD = Number(opts.priceUSD || 0);
  const fallbackPct = Number(opts.fallbackPctOfPrice ?? 0.5);

  let freight, mode;

  if (cf > 0 && isFinite(cf)) {
    freight = Math.max(minF, cf * rate);
    mode = "cubic_feet";
  } else {
    freight = Math.max(minF, priceUSD * fallbackPct);
    mode = "percent_of_price";
  }

  return {
    freight: round2(freight),
    inputs: {
      mode,
      cubicFeet: round2(cf),
      ratePerFt3: round2(rate),
      minFreightUSD: round2(minF),
      fallbackPctOfPrice: round2(fallbackPct),
    },
  };
}

/**
 * Optional: full pricing composer (kept for later if needed)
 * NOTE: Do NOT use this to populate “Est. shipping” on the card.
 */
function computePricing(opts = {}) {
  const {
    itemPriceUSD = 0,
    cubicFeet = 0,
    dutyRatePct = 25,
    ratePerFt3 = Number(process.env.OCEAN_RATE_PER_FT3 ?? 8.5),
    minFreightUSD = Number(process.env.MIN_FREIGHT_USD ?? 30),
    applyNJTax = String(process.env.APPLY_NJ_TAX ?? "true") === "true",
    njTaxRatePct = Number(process.env.NJ_TAX_RATE_PCT ?? 6.625),
    marginPct = Number(process.env.MARGIN_PCT ?? 20),
    fixedFeesUSD = Number(process.env.FIXED_FEES_USD ?? 0),
  } = opts;

  const freightRes = computeFreight({ cubicFeet, ratePerFt3, minFreightUSD });
  const njTax = applyNJTax ? Number(itemPriceUSD) * (njTaxRatePct / 100) : 0;
  const duty = computeDuty({ itemUSD: itemPriceUSD, njTaxUSD: njTax, dutyRate: dutyRatePct / 100 });
  const wharfage = computeWharfage({ itemUSD: itemPriceUSD, njTaxUSD: njTax });
  const landed = Number(itemPriceUSD) + njTax + freightRes.freight + fixedFeesUSD + duty + wharfage;
  const marginAmt = landed * (marginPct / 100);
  let retail = landed + marginAmt;

  const roundRetail95 = String(process.env.ROUND_RETAIL_95 ?? "true") === "true";
  if (roundRetail95 && retail > 0) {
    retail = Math.floor(retail) + 0.95;
  }

  return {
    inputs: {
      itemPriceUSD: round2(itemPriceUSD),
      cubicFeet: round2(cubicFeet),
      dutyRatePct: round2(dutyRatePct),
      ratePerFt3: round2(ratePerFt3),
      minFreightUSD: round2(minFreightUSD),
      applyNJTax,
      njTaxRatePct: round2(njTaxRatePct),
      marginPct: round2(marginPct),
      fixedFeesUSD: round2(fixedFeesUSD),
    },
    breakdown: {
      njTax: round2(njTax),
      freight: round2(freightRes.freight),
      duty: round2(duty),
      wharfage: round2(wharfage),
      fixedFees: round2(fixedFeesUSD),
      landed: round2(landed),
      marginAmt: round2(marginAmt),
    },
    totals: {
      retail: round2(retail),
    },
  };
}

module.exports = { computeFreight, computePricing, computeDuty, computeWharfage, DUTY_PCT, WHARFAGE_PCT, round2 };
