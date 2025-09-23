// Test script for tiered price selection logic
function selectPrice(productData) {
  const candidates = [
    { k: "currentPrice", v: productData?.currentPrice },
    { k: "salePrice", v: productData?.salePrice },
    { k: "regularPrice", v: productData?.regularPrice },
    { k: "listPrice", v: productData?.listPrice },
    { k: "price", v: productData?.price }
  ]
  .filter(c => c.v != null)
  .map(c => ({ k: c.k, n: toNumber(c.v) }))
  .filter(c => isFinite(c.n) && c.n > 0);

  if (candidates.length === 0) return null;

  // Determine tier and minimum price
  const volumeFt3 = productData?.volumeFt3 || 0;
  const nameText = (productData?.name || '').toLowerCase();
  const breadcrumbText = (productData?.breadcrumbs || []).join(' ').toLowerCase();
  const searchText = `${nameText} ${breadcrumbText}`;

  let tier, minPrice;
  if (volumeFt3 > 20 || /sectional|chaise|3-seater|4-seater/.test(searchText)) {
    tier = 'LARGE';
    minPrice = 200;
  } else if (volumeFt3 >= 10 || /sofa|couch|loveseat/.test(searchText)) {
    tier = 'MEDIUM';
    minPrice = 100;
  } else {
    tier = 'SMALL';
    minPrice = 50;
  }

  // Try candidates in priority order
  const priorityOrder = ["currentPrice", "salePrice", "regularPrice", "listPrice", "price"];
  for (const fieldName of priorityOrder) {
    const candidate = candidates.find(c => c.k === fieldName);
    if (candidate && candidate.n >= minPrice) {
      return { k: candidate.k, n: candidate.n, tier, minPrice };
    }
  }

  // If none in priority order meet tier, pick highest that meets tier
  const validCandidates = candidates.filter(c => c.n >= minPrice);
  if (validCandidates.length > 0) {
    const highest = validCandidates.sort((a, b) => b.n - a.n)[0];
    return { k: highest.k, n: highest.n, tier, minPrice };
  }

  // None meet tier requirement
  return { tier, minPrice, failed: true };
}

function toNumber(x) {
  if (typeof x === "number") return x;
  if (typeof x !== "string") return NaN;
  const cleaned = x.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  return parseFloat(cleaned);
}

// Test cases
const testCases = [
  {
    name: "Large sectional with bad primary price",
    data: {
      name: "3-Piece Sectional Sofa",
      price: '45.99',
      regularPrice: '899.99',
      volumeFt3: 25
    },
    expected: { source: 'regularPrice', price: 899.99, tier: 'LARGE' }
  },
  {
    name: "Medium sofa with current price",
    data: {
      name: "Modern Loveseat",
      currentPrice: '129.99',
      volumeFt3: 12
    },
    expected: { source: 'currentPrice', price: 129.99, tier: 'MEDIUM' }
  },
  {
    name: "Small item accepts lower price",
    data: {
      name: "Coffee Table",
      currentPrice: '65.99',
      volumeFt3: 3
    },
    expected: { source: 'currentPrice', price: 65.99, tier: 'SMALL' }
  },
  {
    name: "Large item with all prices too low",
    data: {
      name: "Sectional Couch",
      price: '25.50',
      currentPrice: '30.00',
      salePrice: '22.99',
      volumeFt3: 25
    },
    expected: { failed: true, tier: 'LARGE' }
  }
];

console.log("🧪 Testing tiered price selection logic:\n");

testCases.forEach((test, index) => {
  console.log(`Test ${index + 1}: ${test.name}`);
  console.log(`Input:`, test.data);
  
  const result = selectPrice(test.data);
  console.log(`Result:`, result);
  
  // Validate result
  if (test.expected.failed) {
    const passed = result && result.failed && result.tier === test.expected.tier;
    console.log(`✅ Test result: ${passed ? 'PASS' : 'FAIL'}`);
  } else {
    const passed = result && 
      result.k === test.expected.source && 
      result.n === test.expected.price && 
      result.tier === test.expected.tier;
    console.log(`✅ Test result: ${passed ? 'PASS' : 'FAIL'}`);
  }
  
  console.log('---\n');
});

console.log("✅ All tests completed!");