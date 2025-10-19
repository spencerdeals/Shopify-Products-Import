const SAFETY_FACTOR = 1.15;
const MIN_CHARGE_CUFT = 2.2;
const MAX_CUFT = 180;

const CATEGORY_FALLBACKS = {
  chair: 3,
  sofa: 56,
  table: 8,
  desk: 8,
  bed: 40,
  dresser: 25,
  decor: 2,
  default: 11.33
};

function parseBoxesText(boxesText) {
  if (!boxesText) return [];
  const lines = boxesText.split('\n').map(l => l.trim()).filter(Boolean);
  const boxes = [];

  for (const line of lines) {
    const match = line.match(/(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)/i);
    if (match) {
      boxes.push({
        h: parseFloat(match[1]),
        w: parseFloat(match[2]),
        d: parseFloat(match[3])
      });
    }
  }

  return boxes;
}

function dimsToCuft(h, w, d) {
  return (h * w * d) / 1728;
}

function resolveCartonCuft({ category, scrapedDims, boxesText }) {
  let preSafetyCuft = 0;
  let source = 'fallback';
  let fallbackCategory = null;

  if (boxesText) {
    const boxes = parseBoxesText(boxesText);
    if (boxes.length > 0) {
      preSafetyCuft = boxes.reduce((sum, box) => {
        return sum + dimsToCuft(box.h, box.w, box.d);
      }, 0);
      source = 'actual_boxes';
    }
  }

  if (preSafetyCuft === 0 && scrapedDims && scrapedDims.h && scrapedDims.w && scrapedDims.d) {
    preSafetyCuft = dimsToCuft(scrapedDims.h, scrapedDims.w, scrapedDims.d);
    source = 'scraped_dims';
  }

  if (preSafetyCuft === 0) {
    const catKey = category ? category.toLowerCase() : 'default';
    fallbackCategory = CATEGORY_FALLBACKS[catKey] || CATEGORY_FALLBACKS.default;
    preSafetyCuft = fallbackCategory;
    source = 'fallback';
  }

  preSafetyCuft = Math.max(preSafetyCuft, MIN_CHARGE_CUFT);

  let cuft = preSafetyCuft * SAFETY_FACTOR;

  cuft = Math.min(cuft, MAX_CUFT);

  cuft = Math.round(cuft * 100) / 100;
  preSafetyCuft = Math.round(preSafetyCuft * 100) / 100;

  return {
    cuft,
    detail: {
      safetyFactor: SAFETY_FACTOR,
      preSafetyCuft,
      source,
      fallbackCategory
    }
  };
}

module.exports = { resolveCartonCuft };
