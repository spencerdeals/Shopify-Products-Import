const { toNum } = require("./dimensionUtils");
const { classifyRetailer } = require("./retailerProfiles");
const H = require("./categoryHeuristics");

const RATE_PER_FT3   = toNum(process.env.FREIGHT_RATE_PER_FT3)      || 9;
const BUF_PCT        = toNum(process.env.FREIGHT_DEFAULT_BUFFER_PCT) || 0.15;
const FRAGILE_PCT    = toNum(process.env.FREIGHT_FRAGILE_PCT)        || 0.20;
const OVERSIZE_PCT   = toNum(process.env.FREIGHT_OVERSIZE_PCT)       || 0.10;
const PCT_OF_PRICE   = toNum(process.env.FREIGHT_PERCENT_OF_PRICE)   || 0.60;
const RATE_PER_LB    = toNum(process.env.FREIGHT_RATE_PER_LB)        || 1.2;
const MULTI_CARTON_P = toNum(process.env.FREIGHT_MULTI_CARTON_PCT)   || 0.08;
const HIGH_END_CRATE = toNum(process.env.FREIGHT_HIGH_END_CRATE_PCT) || 0.25;

function withPct(n,p){ return Math.round(n*(1+p)*100)/100; }

function maybeFragileSurcharge(name, t){
  if(name==="mirror" || /glass|mirror/.test(t)) return FRAGILE_PCT;
  if(name==="lighting" && /(glass|crystal|chandelier)/.test(t)) return FRAGILE_PCT;
  return 0;
}

function isOversizeByTextOrDims(product){
  const d = product.dimensionsInches;
  if(d && Math.max(d.h||0,d.w||0,d.d||0) > 80) return true;
  const t = [
    product.title, product.name, product.description, product.breadcrumbs
  ].join(" ").toLowerCase();
  return /(oversized|extra[-\s]?large)/.test(t);
}

function estimateByCategory(product, log){
  const t = [
    product.title, product.name, product.category, product.breadcrumbs,
    product.description, product.descriptionHtml,
    JSON.stringify(product.additionalProperties||{}),
    Array.isArray(product.variants)?product.variants.join(" "):""
  ].join(" ").toLowerCase();

  const tries = [
    ["mattress",     H.mattressCuFt],
    ["bedding",      H.beddingCuFt],
    ["bed_flat",     H.bedFlatpackCuFt],
    ["table_flat",   H.diningTableFlatpackCuFt],
    ["rug",          H.rugCuFt],
    ["mirror",       H.mirrorGlassArtCuFt],
    ["sofa",         H.sofaCuFt],
    ["casegood",     H.casegoodCuFt],
    ["lighting",     H.lightingCuFt],
    ["seating",      H.seatingCuFt],
    ["outdoor",      H.outdoorCuFt],
    ["appliance",    H.applianceCuFt],
    ["tv",           H.tvElectronicsCuFt],
    ["gym",          H.gymCuFt],
    ["baby",         H.babyCuFt],
    ["decor",        H.smallDecorCuFt],
  ];

  for(const [name,fn] of tries){
    const r = fn(product);
    if(r && r.cuft){
      let amt = r.cuft * RATE_PER_FT3;
      if(r.cuft >= 25) amt = withPct(amt, MULTI_CARTON_P);

      let sur = maybeFragileSurcharge(name, t);
      if(isOversizeByTextOrDims(product)) sur += OVERSIZE_PCT;

      const { tier } = classifyRetailer(product);
      if(tier === "high") sur += HIGH_END_CRATE;

      amt = withPct(amt, BUF_PCT);
      if(sur>0) amt = withPct(amt, sur);

      Object.assign(log, {
        freightStrategy:`cat:${name}`,
        cuft:r.cuft, ratePerFt3:RATE_PER_FT3, bufferPct:BUF_PCT,
        tier: tier, surchargePct: sur||0, meta:r.meta
      });
      return { amount: amt, mode:`cat_${name}`, cuft:r.cuft };
    }
  }
  return null;
}

function weightBased(product, log){
  const w = toNum(product.weight) || toNum(product.shippingWeight) || toNum(product.additionalProperties?.weight);
  if(!w) return null;
  let amt = w * RATE_PER_LB;
  const { tier } = classifyRetailer(product);
  if(tier === "high") amt = withPct(amt, HIGH_END_CRATE);
  amt = withPct(amt, BUF_PCT);
  Object.assign(log, { freightStrategy:"weight_based", weight:w, ratePerLb:RATE_PER_LB, tier, bufferPct:BUF_PCT });
  return { amount: amt, mode:"weight_based", cuft: 0 };
}

function percentOfPrice(product, log){
  const price = toNum(product.price) || 0;
  const amt = Math.round(price * PCT_OF_PRICE * 100)/100;
  Object.assign(log, { freightStrategy:"percent_of_price", percent:PCT_OF_PRICE });
  return { amount: amt, mode:"percent_of_price", cuft: 0 };
}

function calcFreightSmart(product, log = {}) {
  if(product.cartonCubicFeet && product.cartonCubicFeet > 0){
    let amt = product.cartonCubicFeet * RATE_PER_FT3;
    const { tier } = classifyRetailer(product);
    if(product.cartonCubicFeet >= 25) amt = withPct(amt, MULTI_CARTON_P);
    if(tier === "high") amt = withPct(amt, HIGH_END_CRATE);
    amt = withPct(amt, BUF_PCT);
    Object.assign(log, {
      freightStrategy:"carton_explicit",
      cuft:product.cartonCubicFeet, ratePerFt3:RATE_PER_FT3, bufferPct:BUF_PCT, tier
    });
    return { amount: amt, mode:"carton_explicit", cuft: product.cartonCubicFeet };
  }

  const cat = estimateByCategory(product, log);
  if(cat) return { ...cat, log };

  const w = weightBased(product, log);
  if(w) return { ...w, log };

  const p = percentOfPrice(product, log);
  return { ...p, log };
}

module.exports = { calcFreightSmart };
