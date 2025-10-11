const SAFETY_FACTOR = 1.15;

const CATEGORY_FALLBACK_CUFT = {
  sofa: 56,
  sectional: 56,
  couch: 56,
  loveseat: 35,
  recliner: 28,
  chair: 3,
  office_chair: 3,
  desk: 3,
  table: 8,
  dresser: 18,
  bedframe: 14,
  mattress: 20,
  other: 11.33
};

const FREIGHT_RATES = {
  lclLow: 16,
  lclMid: 18,
  smallsHigh: 45,
  smallsUltra: 70
};

const CLAMPS = {
  minCuft: 0.8,
  maxCuft: 180,
  smallsMinChargeCuft: 2.2
};

module.exports = {
  SAFETY_FACTOR,
  CATEGORY_FALLBACK_CUFT,
  FREIGHT_RATES,
  CLAMPS
};
