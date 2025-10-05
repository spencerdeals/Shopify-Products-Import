const { estimateCarton, applyMultiplierGuardrails } = require('../backend/cartonEstimator');

console.log('=== CARTON ESTIMATOR TEST ===\n');

console.log('Test 1: IKEA Sectional Sofa');
const ikeaSectional = estimateCarton({
  name: 'IKEA VIMLE Sectional Sofa',
  price: 1200,
  retailer: 'IKEA',
  url: 'https://ikea.com/sectional',
  breadcrumbs: ['Furniture', 'Living Room', 'Sectional']
});
console.log(JSON.stringify(ikeaSectional, null, 2));
console.log('');

console.log('Test 2: Wayfair Sofa');
const wayfairSofa = estimateCarton({
  name: 'Modern Sofa',
  price: 800,
  retailer: 'Wayfair',
  url: 'https://wayfair.com/sofa',
  breadcrumbs: ['Furniture', 'Living Room', 'Sofas']
});
console.log(JSON.stringify(wayfairSofa, null, 2));
console.log('');

console.log('Test 3: Generic Chair');
const genericChair = estimateCarton({
  name: 'Office Chair',
  price: 200,
  retailer: 'Amazon',
  url: 'https://amazon.com/chair',
  category: 'furniture'
});
console.log(JSON.stringify(genericChair, null, 2));
console.log('');

console.log('Test 4: IKEA Bed Frame with density check');
const ikeaBed = estimateCarton({
  name: 'IKEA MALM Bed Frame',
  price: 500,
  retailer: 'IKEA',
  url: 'https://ikea.com/bed',
  weight: 100,
  breadcrumbs: ['Furniture', 'Bedroom', 'Beds']
});
console.log(JSON.stringify(ikeaBed, null, 2));
console.log('');

console.log('=== MULTIPLIER GUARDRAILS TEST ===\n');

console.log('Test 5: Normal multiplier (1.9x)');
const normal = applyMultiplierGuardrails(1900, 1000);
console.log(JSON.stringify(normal, null, 2));
console.log('');

console.log('Test 6: Too low multiplier (1.5x) - should trigger fallback');
const tooLow = applyMultiplierGuardrails(1500, 1000);
console.log(JSON.stringify(tooLow, null, 2));
console.log('');

console.log('Test 7: Too high multiplier (3.0x) - should trigger fallback');
const tooHigh = applyMultiplierGuardrails(3000, 1000);
console.log(JSON.stringify(tooHigh, null, 2));
console.log('');

console.log('✅ All tests completed');
