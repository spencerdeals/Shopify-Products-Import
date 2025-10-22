/**
 * Pricing Helpers
 *
 * Helper functions for price calculation including rounding to nearest $5
 */

/**
 * Round up to next multiple of 5
 * Examples:
 *   101 → 105
 *   105 → 105
 *   102.5 → 105
 *   99.99 → 100
 */
function ceilToNext5(price) {
  if (!price || price <= 0) return 0;
  return Math.ceil(price / 5) * 5;
}

/**
 * Calculate retail price with margin and rounding
 * @param {number} landedCost - Total landed cost
 * @param {number} marginPercent - Margin percentage (e.g., 40 for 40%)
 * @param {boolean} roundToNext5 - Whether to round to next $5
 * @returns {number} Final retail price
 */
function calculateRetailPrice(landedCost, marginPercent, roundToNext5 = true) {
  if (!landedCost || landedCost <= 0) return 0;

  const margin = marginPercent / 100;
  const price = landedCost * (1 + margin);

  if (roundToNext5) {
    return ceilToNext5(price);
  }

  return Math.round(price * 100) / 100; // Round to 2 decimals
}

/**
 * Calculate compare at price (optional higher price for display)
 * Typically 10-20% higher than retail price
 */
function calculateCompareAtPrice(retailPrice, percentHigher = 15) {
  if (!retailPrice || retailPrice <= 0) return null;

  const compareAt = retailPrice * (1 + percentHigher / 100);
  return ceilToNext5(compareAt);
}

/**
 * Validate pricing calculations
 * Returns array of error messages (empty if valid)
 */
function validatePricing(landedCost, retailPrice) {
  const errors = [];

  if (!landedCost || landedCost <= 0) {
    errors.push('Landed cost must be positive');
  }

  if (!retailPrice || retailPrice <= 0) {
    errors.push('Retail price must be positive');
  }

  if (landedCost && retailPrice && retailPrice < landedCost) {
    errors.push('Retail price must be greater than landed cost');
  }

  const margin = landedCost && retailPrice ? ((retailPrice - landedCost) / landedCost) * 100 : 0;
  if (margin < 10) {
    errors.push(`Margin too low: ${margin.toFixed(1)}% (minimum 10% recommended)`);
  }

  return errors;
}

/**
 * Calculate all pricing fields for a variant
 */
function calculateVariantPricing(costing, options = {}) {
  const {
    marginPercent = 40,
    roundToNext5 = true,
    includeCompareAt = false
  } = options;

  const landedCost = costing.landed_cost_usd || 0;
  const retailPrice = calculateRetailPrice(landedCost, marginPercent, roundToNext5);
  const compareAtPrice = includeCompareAt ? calculateCompareAtPrice(retailPrice) : null;

  const validation = validatePricing(landedCost, retailPrice);

  return {
    landedCost,
    retailPrice,
    compareAtPrice,
    marginPercent,
    marginDollars: retailPrice - landedCost,
    validation,
    isValid: validation.length === 0
  };
}

module.exports = {
  ceilToNext5,
  calculateRetailPrice,
  calculateCompareAtPrice,
  validatePricing,
  calculateVariantPricing
};
