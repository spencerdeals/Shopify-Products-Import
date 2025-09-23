// Test script for price selection logic
function pickPrice(z) {
  const candidates = [
    {k: "currentPrice", v: z?.currentPrice},
    {k: "salePrice",    v: z?.salePrice},
    {k: "regularPrice", v: z?.regularPrice},
    {k: "listPrice",    v: z?.listPrice},
    {k: "price",        v: z?.price},
  ]
  .filter(c => c.v != null)
  .map(c => ({ k: c.k, n: toNumber(c.v) }))
  .filter(c => isFinite(c.n) && c.n > 0);

  if (candidates.length === 0) return null;

  // Heuristic: sofas/large items shouldn't be under $100
  const categoryHint = (z?.category || z?.breadcrumbs?.join(" ") || "" + z?.name || "").toLowerCase();
  const isLargeItem = (z?.volumeFt3 && z.volumeFt3 >= 10) || /sofa|sectional|couch|chaise/.test(categoryHint);

  // Prefer by field priority first, then sanity
  const byPriority = ["currentPrice","salePrice","regularPrice","listPrice","price"];
  let best = candidates.sort((a,b) => byPriority.indexOf(a.k) - byPriority.indexOf(b.k))[0];

  if (isLargeItem && best.n < 100) {
    // try to find a saner candidate
    const sane = candidates
      .filter(c => c.n >= 100)
      .sort((a,b) => byPriority.indexOf(a.k) - byPriority.indexOf(b.k))[0];
    if (sane) best = sane;
  }

  return best; // {k, n}
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
    name: "Sofa with bad primary price",
    data: {
      name: "Brittany Sofa Futon",
      price: '40.5',
      salePrice: undefined,
      currentPrice: undefined,
      regularPrice: '299.99',
      category: "furniture"
    }
  },
  {
    name: "Normal product with current price",
    data: {
      name: "Coffee Table",
      price: '150.00',
      currentPrice: '129.99',
      salePrice: '119.99',
      regularPrice: '150.00'
    }
  },
  {
    name: "Large item with all low prices",
    data: {
      name: "Sectional Couch",
      price: '25.50',
      currentPrice: '30.00',
      salePrice: '22.99',
      volumeFt3: 15
    }
  }
];

console.log("Testing price selection logic:\n");

testCases.forEach(test => {
  console.log(`Test: ${test.name}`);
  console.log(`Input:`, test.data);
  const result = pickPrice(test.data);
  console.log(`Result:`, result);
  console.log('---\n');
});
