const fs = require('fs');
const path = require('path');

let tariffMap = null;
let loadError = null;

function loadTariffMap() {
  if (tariffMap) return tariffMap;

  try {
    const mapPath = path.join(__dirname, '../../config/tariff/bermuda_duty_map.json');
    const data = fs.readFileSync(mapPath, 'utf8');
    tariffMap = JSON.parse(data);
    console.log(`✅ Loaded Bermuda duty tariff map v${tariffMap._meta.version} with ${tariffMap.rules.length} rules`);
    return tariffMap;
  } catch (err) {
    loadError = err;
    console.error('⚠️ Failed to load tariff map, using default 26.5%:', err.message);
    return {
      _meta: { defaultDutyPct: 26.5 },
      rules: []
    };
  }
}

function normalize(str) {
  if (!str) return '';
  return String(str).toLowerCase().trim();
}

function estimateDuty({ category, title, brand, vendor, hsCode }) {
  const map = loadTariffMap();
  const defaultDutyPct = map._meta.defaultDutyPct || 26.5;

  const normCategory = normalize(category);
  const normTitle = normalize(title);
  const normBrand = normalize(brand);
  const normVendor = normalize(vendor);
  const normHsCode = normalize(hsCode);

  const searchText = `${normTitle} ${normCategory} ${normBrand}`.toLowerCase();

  let bestMatch = null;
  let bestScore = 0;

  for (const rule of map.rules) {
    let score = 0;
    let matched = false;

    // Priority 1: HS code match (highest priority)
    if (normHsCode && rule.match.hs && rule.match.hs.length > 0) {
      for (const hsPrefix of rule.match.hs) {
        if (normHsCode.startsWith(normalize(hsPrefix))) {
          score = 1000;
          matched = true;
          break;
        }
      }
    }

    // Priority 2: Vendor match
    if (!matched && rule.match.vendorsAny && rule.match.vendorsAny.length > 0) {
      for (const v of rule.match.vendorsAny) {
        if (normVendor && normVendor.includes(normalize(v))) {
          score = 100;
          matched = true;
          break;
        }
      }
    }

    // Priority 3: Keyword match
    if (!matched && rule.match.keywordsAny && rule.match.keywordsAny.length > 0) {
      let keywordHits = 0;
      for (const kw of rule.match.keywordsAny) {
        if (searchText.includes(normalize(kw))) {
          keywordHits++;
        }
      }
      if (keywordHits > 0) {
        score = keywordHits;
        matched = true;
      }
    }

    // Choose best match (highest score, or if tie, lowest duty)
    if (matched && (score > bestScore || (score === bestScore && rule.dutyPct < bestMatch.dutyPct))) {
      bestScore = score;
      bestMatch = rule;
    }
  }

  if (bestMatch) {
    const dutyPct = Math.max(0, Math.min(40, bestMatch.dutyPct));
    const source = bestScore >= 1000 ? 'hs-code' : (bestScore >= 100 ? 'vendor' : 'keyword');
    console.log(`   💵 Duty chosen: ${dutyPct}% via ${source} (${bestMatch.note})`);
    return { dutyPct, source };
  }

  const source = loadError ? 'default-fallback' : 'default';
  console.log(`   💵 Duty chosen: ${defaultDutyPct}% via ${source}`);
  return { dutyPct: defaultDutyPct, source };
}

module.exports = { estimateDuty };
