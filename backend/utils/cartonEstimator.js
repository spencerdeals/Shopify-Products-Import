const fs = require('fs');
const path = require('path');
const { detectFlatpackCategory } = require('./gptCategoryHelper');
const { resolveCartonCuft } = require('../../shared/resolveCuft.js');

const ROUND_TO = 0.5;

let vendorRules = {};
try {
  const vendorRulesPath = path.join(__dirname, '../../data/vendorRules.json');
  vendorRules = JSON.parse(fs.readFileSync(vendorRulesPath, 'utf8'));
} catch (err) {
  console.warn('⚠️  Failed to load vendorRules.json, using empty rules', err.message);
}

const VENDOR_TIER_MULT = vendorRules.vendorMultiplier || {
  flatpack: 0.6,
  assembled: 1.0,
  premium: 1.0,
  neutral: 1.0,
};

const PROFILE_RULES = {
  sofa:       { factor: 0.50, padding: 0.06, boxes: 2, clampPct: 0.25, minFloorFt3: 15 },
  sectional:  { factor: 0.50, padding: 0.06, boxes: 2, clampPct: 0.25, minFloorFt3: 15 },
  chair:      { factor: 0.60, padding: 0.05, boxes: 1, clampPct: 0.25, minFloorFt3: 8  },
  table:      { factor: 0.80, padding: 0.05, boxes: 1, clampPct: 0.25, minFloorFt3: 10 },
  bed:        { factor: 0.55, padding: 0.05, boxes: 2, clampPct: 0.25, minFloorFt3: 12 },
  default:    { factor: 0.85, padding: 0.05, boxes: 1, clampPct: 0.30, minFloorFt3: 5  },
};

function normalize(str = "") {
  return String(str).toLowerCase().replace(/\s+/g, " ").trim();
}

function getVendorTier(retailerName = "") {
  const n = normalize(retailerName);
  const assembled = vendorRules.assembledVendors || [];
  const flatpack = vendorRules.flatpackVendors || [];

  if (assembled.some(v => n.includes(v))) {
    return { tier: "assembled", confidence: 0.85, source: "vendor_tier" };
  }
  if (flatpack.some(v => n.includes(v))) {
    return { tier: "flatpack", confidence: 0.85, source: "vendor_tier" };
  }
  return null;
}

function roundHalf(v) {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.round(v / ROUND_TO) * ROUND_TO);
}

function inchesToFt3(L, W, H) {
  const l = Number(L) || 0, w = Number(W) || 0, h = Number(H) || 0;
  if (l <= 0 || w <= 0 || h <= 0) return 0;
  return (l * w * h) / 1728;
}

function computeFromBoxes(boxes = []) {
  const total = boxes.reduce((acc, b) => acc + inchesToFt3(b.L ?? b.length, b.W ?? b.width, b.H ?? b.height), 0);
  return roundHalf(total);
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function getAssembledFt3(product = {}) {
  const A = product.assembled || {};
  const L = A.length ?? A.L ?? A.l;
  const W = A.width  ?? A.W ?? A.w;
  const H = A.height ?? A.H ?? A.h;
  return inchesToFt3(L, W, H);
}

function estimateCarton(product = {}) {
  const notes = [];
  const retailer = product.retailer || "";
  const profileKey = normalize(product.profile || "default");
  let vendorTierKey = normalize(product.vendorTier || "neutral");
  let confidence = 0.7;
  let source = "profile_heuristic_v6";

  if (product.carton && Array.isArray(product.carton.boxes) && product.carton.boxes.length > 0) {
    const boxesText = product.carton.boxes
      .map(b => `${b.H || b.height} x ${b.W || b.width} x ${b.L || b.length}`)
      .join('\n');

    const resolved = resolveCartonCuft({
      category: product.profile || product.category,
      boxesText
    });

    notes.push(`admin_boxes:${product.carton.boxes.length}`);
    notes.push(`safety_factor:${resolved.detail.safetyFactor}`);
    notes.push(`pre_safety:${resolved.detail.preSafetyCuft}`);

    console.log(JSON.stringify({
      tag: "cuft_resolve",
      url: product?.url || null,
      sku: product?.sku || null,
      category: product.profile || product.category,
      cuft_final: resolved.cuft,
      source: resolved.detail.source,
      preMinCuft: resolved.detail.preMinCuft,
      preSafetyCuft: resolved.detail.preSafetyCuft,
      safetyFactor: resolved.detail.safetyFactor
    }));

    return {
      cubic_feet: resolved.cuft,
      boxes: product.carton.boxes.length,
      source: "admin_override",
      notes,
      confidence: 1.0,
    };
  }

  let tierInfo = getVendorTier(retailer);
  if (tierInfo) {
    vendorTierKey = tierInfo.tier;
    confidence = tierInfo.confidence;
    source = tierInfo.source;
    notes.push(`vendor_tier:${vendorTierKey}`);
  } else {
    const productText = `${product.name || ""} ${product.description || ""} ${retailer}`;
    const gptResult = detectFlatpackCategory(productText);
    vendorTierKey = gptResult.inferredTier;
    confidence = gptResult.confidence;
    source = "ai_inferred";
    notes.push(`ai_inferred:${vendorTierKey}`, `reason:${gptResult.reason}`);
  }

  const rule = PROFILE_RULES[profileKey] || PROFILE_RULES.default;
  const assembledFt3 = getAssembledFt3(product);
  if (!assembledFt3) {
    notes.push("no_assembled_dims");

    const resolved = resolveCartonCuft({
      category: product.profile || product.category
    });

    notes.push(`safety_factor:${resolved.detail.safetyFactor}`);
    notes.push(`pre_safety:${resolved.detail.preSafetyCuft}`);
    notes.push(`fallback_source:${resolved.detail.source}`);

    console.log(JSON.stringify({
      tag: "cuft_resolve",
      url: product?.url || null,
      sku: product?.sku || null,
      category: product.profile || product.category,
      cuft_final: resolved.cuft,
      source: resolved.detail.source,
      preMinCuft: resolved.detail.preMinCuft,
      preSafetyCuft: resolved.detail.preSafetyCuft,
      safetyFactor: resolved.detail.safetyFactor
    }));

    return {
      cubic_feet: resolved.cuft,
      boxes: null,
      source: resolved.detail.source,
      notes,
      confidence: 0.5
    };
  }

  const vendorMult = VENDOR_TIER_MULT[vendorTierKey] ?? 1.0;

  let base = assembledFt3 * rule.factor * vendorMult;

  if (source !== "vendor_tier" && source !== "ai_inferred") {
    base *= (1 + rule.padding);
  } else if (vendorTierKey === "flatpack") {
    base *= (1 + rule.padding);
    notes.push(`flatpack_padding:${rule.padding}`);
  }

  const minClamp = Math.max(rule.minFloorFt3 || 0, assembledFt3 * (1 - (rule.clampPct || 0.25)));
  const maxClamp = Math.max(assembledFt3 * (1 + (rule.clampPct || 0.25)), minClamp);
  const clamped = clamp(base, minClamp, maxClamp);

  const cf = roundHalf(clamped);

  const scrapedDims = product.assembled ? {
    h: product.assembled.height || product.assembled.H || product.assembled.h,
    w: product.assembled.width || product.assembled.W || product.assembled.w,
    d: product.assembled.length || product.assembled.L || product.assembled.l
  } : null;

  const resolved = resolveCartonCuft({
    category: product.profile || product.category,
    scrapedDims: scrapedDims && scrapedDims.h && scrapedDims.w && scrapedDims.d ? scrapedDims : null,
    boxesText: null
  });

  const finalCf = resolved.cuft;

  notes.push(`profile:${profileKey}`, `mult:${vendorMult}`, `assembledFt3:${assembledFt3.toFixed(2)}`);
  notes.push(`safety_factor:${resolved.detail.safetyFactor}`);
  notes.push(`pre_safety:${resolved.detail.preSafetyCuft}`);

  console.log(JSON.stringify({
    tag: "cuft_resolve",
    url: product?.url || null,
    sku: product?.sku || null,
    category: product.profile || product.category,
    cuft_final: finalCf,
    source: resolved.detail.source,
    preMinCuft: resolved.detail.preMinCuft,
    preSafetyCuft: resolved.detail.preSafetyCuft,
    safetyFactor: resolved.detail.safetyFactor,
    assembledFt3: assembledFt3
  }));

  return {
    cubic_feet: finalCf,
    boxes: rule.boxes,
    source,
    notes,
    confidence,
  };
}

module.exports = {
  estimateCarton,
  _internals: { inchesToFt3, computeFromBoxes, getAssembledFt3, getVendorTier },
};
