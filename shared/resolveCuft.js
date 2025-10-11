const { CATEGORY_FALLBACK_CUFT, CLAMPS, SAFETY_FACTOR } = require('./estimatorConfig.js');
const { parseBoxesTextToCuft, round2 } = require('./boxes.js');

function pickCategoryFallback(category) {
  if (!category) return CATEGORY_FALLBACK_CUFT.other;

  const normalized = String(category).toLowerCase().trim();

  for (const [key, value] of Object.entries(CATEGORY_FALLBACK_CUFT)) {
    if (normalized.includes(key)) {
      return value;
    }
  }

  return CATEGORY_FALLBACK_CUFT.other;
}

function resolveCartonCuft({ category, scrapedDims, boxesText }) {
  let source = 'fallback';
  let useCuft = null;
  const actual = parseBoxesTextToCuft(boxesText);

  // 1) Actual boxes override
  if (actual?.totalCuft) {
    useCuft = round2(actual.totalCuft);
    source = 'actual_boxes';
  }

  // 2) Scraped single HxWxD
  if (useCuft == null && scrapedDims && scrapedDims.h && scrapedDims.w && scrapedDims.d) {
    const raw = (scrapedDims.h * scrapedDims.w * scrapedDims.d) / 1728;
    useCuft = round2(raw);
    source = 'scraped_dims';
  }

  // 3) Category fallback
  if (useCuft == null) {
    useCuft = pickCategoryFallback(category);
    source = 'fallback';
  }

  const preMinCuft = useCuft;

  // Small-parcel minimum (per item when no multi-box known)
  if (!actual && useCuft < CLAMPS.smallsMinChargeCuft) {
    useCuft = CLAMPS.smallsMinChargeCuft;
  }

  // Apply global safety factor to keep us safe
  const preSafetyCuft = useCuft;
  useCuft = round2(useCuft * SAFETY_FACTOR);

  // Global clamps
  if (useCuft < CLAMPS.minCuft) useCuft = CLAMPS.minCuft;
  if (useCuft > CLAMPS.maxCuft) useCuft = CLAMPS.maxCuft;

  const cuft = round2(useCuft);

  return {
    cuft,
    detail: {
      source,
      actual,
      scrapedDims,
      fallbackCategory: pickCategoryFallback(category),
      preMinCuft: round2(preMinCuft),
      preSafetyCuft: round2(preSafetyCuft),
      safetyFactor: SAFETY_FACTOR
    }
  };
}

module.exports = {
  resolveCartonCuft
};
