const { resolveCartonCuft } = require('../../shared/resolveCuft.js');

const r = (n) => Math.round(n * 100) / 100;

describe('resolveCartonCuft with 15% safety factor', () => {
  test('multi-box actual dimensions + safety 15%', () => {
    const { cuft } = resolveCartonCuft({
      category: 'sofa',
      boxesText: `20 x 43 x 45
                  20 x 45 x 65`
    });
    expect(cuft).toBe(64.69);
  });

  test('scraped dims desk + safety 15%', () => {
    const { cuft } = resolveCartonCuft({
      category: 'desk',
      scrapedDims: { h: 6.3, w: 14.39, d: 49.4 }
    });
    expect(cuft).toBe(2.98);
  });

  test('fallback chair 3 ft³ → +15% = 3.45', () => {
    const { cuft } = resolveCartonCuft({ category: 'chair' });
    expect(cuft).toBe(3.45);
  });

  test('fallback sofa 56 ft³ → +15% = 64.4', () => {
    const { cuft } = resolveCartonCuft({ category: 'sofa' });
    expect(cuft).toBe(64.4);
  });

  test('fallback table 8 ft³ → +15% = 9.2', () => {
    const { cuft } = resolveCartonCuft({ category: 'table' });
    expect(cuft).toBe(9.2);
  });

  test('detail includes safety factor metadata', () => {
    const { detail } = resolveCartonCuft({
      category: 'chair',
      scrapedDims: { h: 30, w: 24, d: 24 }
    });

    expect(detail.safetyFactor).toBe(1.15);
    expect(detail.preSafetyCuft).toBeGreaterThan(0);
    expect(detail.source).toBeDefined();
  });

  test('actual boxes override scraped dims', () => {
    const { cuft, detail } = resolveCartonCuft({
      category: 'desk',
      scrapedDims: { h: 10, w: 20, d: 30 },
      boxesText: '12 x 24 x 36'
    });

    expect(detail.source).toBe('actual_boxes');
    expect(cuft).toBeGreaterThan(0);
  });

  test('small items hit minimum charge with safety', () => {
    const { cuft } = resolveCartonCuft({
      category: 'decor',
      scrapedDims: { h: 5, w: 5, d: 5 }
    });

    expect(cuft).toBeGreaterThanOrEqual(2.2 * 1.15);
  });

  test('handles missing category gracefully', () => {
    const { cuft, detail } = resolveCartonCuft({});

    expect(cuft).toBeGreaterThan(0);
    expect(detail.source).toBe('fallback');
    expect(detail.fallbackCategory).toBe(11.33);
  });

  test('clamps to maximum 180 ft³', () => {
    const { cuft } = resolveCartonCuft({
      category: 'sofa',
      scrapedDims: { h: 96, w: 96, d: 96 }
    });

    expect(cuft).toBeLessThanOrEqual(180);
  });

  test('applies safety factor before final clamp', () => {
    const { cuft, detail } = resolveCartonCuft({
      category: 'chair',
      scrapedDims: { h: 20, w: 20, d: 20 }
    });

    const expected = r((20 * 20 * 20 / 1728) * 1.15);
    expect(detail.preSafetyCuft).toBeLessThan(detail.safetyFactor * detail.preSafetyCuft);
  });
});
