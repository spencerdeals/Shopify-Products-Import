const { computePricing, round2 } = require('../../shared/pricing');

describe('Pricing Calculations', () => {
  test('Happy path - Wayfair sofa example', () => {
    const res = computePricing({
      itemSubtotal: 414.99,
      freight: 503.01
    });

    expect(res.breakdown.njSalesTax).toBe(27.49);
    expect(res.totals.customsBase).toBe(442.48);
    expect(res.breakdown.duty).toBe(110.62);
    expect(res.breakdown.wharfage).toBe(6.64);
    expect(res.breakdown.margin).toBe(229.5);
    expect(res.breakdown.shippingAndHandling).toBe(760.0);
    expect(res.totals.totalLanded).toBe(1292.25);
  });

  test('No NJ tax scenario (tax-exempt)', () => {
    const res = computePricing({
      itemSubtotal: 1000,
      freight: 200,
      njTaxRate: 0
    });

    expect(res.breakdown.njSalesTax).toBe(0);
    expect(res.breakdown.duty).toBe(250);
    expect(res.breakdown.wharfage).toBe(15);
    expect(res.breakdown.margin).toBe(300);
    expect(res.breakdown.shippingAndHandling).toBe(500);
  });

  test('Bulk container rate (cheap freight)', () => {
    const res = computePricing({
      itemSubtotal: 3000,
      freight: 180
    });

    expect(res.breakdown.margin).toBe(round2((3000 + 180) * 0.25));
    expect(res.breakdown.margin).toBe(795);
  });

  test('Rounding consistency', () => {
    const res = computePricing({
      itemSubtotal: 0.1 + 0.2,
      freight: 0.1 + 0.2
    });

    expect(String(res.totals.totalLanded)).not.toMatch(/\.999/);
    expect(res.totals.totalLanded).toBeGreaterThan(0);
  });

  test('Zero values', () => {
    const res = computePricing({
      itemSubtotal: 0,
      freight: 0
    });

    expect(res.totals.totalLanded).toBe(0);
    expect(res.breakdown.duty).toBe(0);
    expect(res.breakdown.wharfage).toBe(0);
    expect(res.breakdown.margin).toBe(0);
  });

  test('Margin calculation - only on items + freight', () => {
    const res = computePricing({
      itemSubtotal: 100,
      freight: 50
    });

    const expectedMargin = round2((100 + 50) * 0.25);
    expect(res.breakdown.margin).toBe(expectedMargin);
    expect(res.breakdown.margin).toBe(37.5);
  });

  test('Duty and wharfage - calculated on item + NJ tax only', () => {
    const res = computePricing({
      itemSubtotal: 1000,
      freight: 500
    });

    const njTax = round2(1000 * 0.06625);
    const customsBase = round2(1000 + njTax);
    const expectedDuty = round2(customsBase * 0.25);
    const expectedWharfage = round2(customsBase * 0.015);

    expect(res.breakdown.njSalesTax).toBe(njTax);
    expect(res.breakdown.duty).toBe(expectedDuty);
    expect(res.breakdown.wharfage).toBe(expectedWharfage);
  });

  test('Custom duty rate', () => {
    const res = computePricing({
      itemSubtotal: 500,
      freight: 100,
      dutyRate: 0.15
    });

    const njTax = round2(500 * 0.06625);
    const customsBase = round2(500 + njTax);
    const expectedDuty = round2(customsBase * 0.15);

    expect(res.breakdown.duty).toBe(expectedDuty);
  });

  test('Shipping & Handling composition', () => {
    const res = computePricing({
      itemSubtotal: 200,
      freight: 100
    });

    const expectedShippingHandling = round2(
      res.breakdown.njSalesTax +
      100 +
      res.breakdown.margin
    );

    expect(res.breakdown.shippingAndHandling).toBe(expectedShippingHandling);
  });
});
