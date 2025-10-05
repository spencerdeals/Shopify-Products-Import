const { estimateCarton, applyMultiplierGuardrails, OCEAN_RATE_PER_FT3 } = require('../backend/cartonEstimator');

console.log('=== WAYFAIR SWAIN SOFA SCENARIO TEST ===\n');

const wayfairProduct = {
  name: 'Swain 89.5" Sofa',
  price: 799.99,
  retailer: 'Wayfair',
  url: 'https://wayfair.com/furniture/sofa',
  brand: 'Wayfair',
  category: 'sofa',
  breadcrumbs: ['Furniture', 'Living Room', 'Sofas & Couches'],
  weight: null
};

console.log('Product:', wayfairProduct.name);
console.log('Price:', `$${wayfairProduct.price}`);
console.log('Retailer:', wayfairProduct.retailer);
console.log('');

const cartonEstimate = estimateCarton(wayfairProduct);
console.log('CARTON ESTIMATION:');
console.log(`  Boxes: ${cartonEstimate.boxes}`);
console.log(`  Dimensions per box: ${cartonEstimate.dimensions.length}" × ${cartonEstimate.dimensions.width}" × ${cartonEstimate.dimensions.height}"`);
console.log(`  Total cubic feet: ${cartonEstimate.cubic_feet.toFixed(2)} ft³`);
console.log(`  Notes: ${cartonEstimate.estimation_notes}`);
console.log('');

const freightCost = cartonEstimate.cubic_feet * OCEAN_RATE_PER_FT3;
const handlingFee = 15;
const totalShipping = freightCost + handlingFee;

console.log('FREIGHT CALCULATION:');
console.log(`  Cubic feet: ${cartonEstimate.cubic_feet.toFixed(2)} ft³`);
console.log(`  Rate: $${OCEAN_RATE_PER_FT3}/ft³`);
console.log(`  Freight: ${cartonEstimate.cubic_feet.toFixed(2)} × $${OCEAN_RATE_PER_FT3} = $${freightCost.toFixed(2)}`);
console.log(`  Handling: $${handlingFee.toFixed(2)}`);
console.log(`  Total shipping: $${totalShipping.toFixed(2)}`);
console.log('');

const itemPrice = wayfairProduct.price;
const dutyRate = 0.265;
const dutyAmount = itemPrice * dutyRate;
const deliveryFee = 0;
const finalTotal = itemPrice + dutyAmount + deliveryFee + totalShipping;

console.log('FULL COST BREAKDOWN:');
console.log(`  Item price: $${itemPrice.toFixed(2)}`);
console.log(`  Duty (26.5%): $${dutyAmount.toFixed(2)}`);
console.log(`  Delivery fee: $${deliveryFee.toFixed(2)}`);
console.log(`  Shipping: $${totalShipping.toFixed(2)}`);
console.log(`  Final total: $${finalTotal.toFixed(2)}`);
console.log('');

const impliedMultiplier = finalTotal / itemPrice;
console.log(`IMPLIED MULTIPLIER: ${impliedMultiplier.toFixed(2)}x`);
console.log('');

const guardrailResult = applyMultiplierGuardrails(finalTotal, itemPrice);
console.log('MULTIPLIER GUARDRAIL CHECK:');
console.log(`  Implied multiplier: ${guardrailResult.implied_multiplier.toFixed(2)}x`);
console.log(`  Bounds: [${guardrailResult.multiplier_bounds[0]}, ${guardrailResult.multiplier_bounds[1]}]`);
console.log(`  Fallback used: ${guardrailResult.multiplier_fallback_used}`);
if (guardrailResult.multiplier_fallback_used) {
  console.log(`  Adjusted total: $${guardrailResult.adjustedTotal.toFixed(2)} (using ${guardrailResult.fallback_multiplier}x)`);
} else {
  console.log(`  ✅ Within acceptable range - no adjustment needed`);
}

console.log('\n✅ Wayfair scenario test completed');
