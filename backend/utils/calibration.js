const CLAMP_MIN = 0.75;
const CLAMP_MAX = 1.25;
const ALPHA = 0.2;

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function kProfileVendor(profile, vendorTier) {
  return `pv:${(profile || 'other')}::${(vendorTier || 'neutral')}`;
}

function kRetailerProfile(retailer, profile) {
  return `rp:${(retailer || '').toLowerCase()}::${(profile || 'other')}`;
}

async function getMultiplier(db, keys) {
  for (const key of keys) {
    try {
      const row = await db.getCalibration(key);
      if (row && typeof row.multiplier === 'number') {
        return clamp(row.multiplier, CLAMP_MIN, CLAMP_MAX);
      }
    } catch (e) {
      continue;
    }
  }
  return 1.0;
}

async function updateEMA(db, key, observedM) {
  const m = clamp(observedM, CLAMP_MIN, CLAMP_MAX);
  let prev = null;
  try {
    prev = await db.getCalibration(key);
  } catch (e) {
  }

  const next = prev && typeof prev.multiplier === 'number'
    ? (ALPHA * m + (1 - ALPHA) * prev.multiplier)
    : m;

  await db.setCalibration(key, next);
  return next;
}

module.exports = {
  CLAMP_MIN,
  CLAMP_MAX,
  ALPHA,
  kProfileVendor,
  kRetailerProfile,
  getMultiplier,
  updateEMA,
};
