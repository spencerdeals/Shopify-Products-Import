function toNum(x){ const n = Number(String(x).replace(/[^0-9.\-]+/g,'')); return Number.isFinite(n)?n:null; }
function inchToFt(n){ return n/12; }
function round2(n){ return Math.round(n*100)/100; }

function parseDimsInches(text){
  if(!text) return null;
  const s = String(text).toLowerCase().replace(/×/g,'x');
  let m = s.match(/(\d+(?:\.\d+)?)\s*[""']?\s*x\s*(\d+(?:\.\d+)?)\s*[""']?\s*x\s*(\d+(?:\.\d+)?)(?:\s*(?:in|[""']))/);
  if(!m) m = s.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
  if(!m) return null;
  const h = toNum(m[1]), w = toNum(m[2]), d = toNum(m[3]);
  if(h && w && d) return { h, w, d, unit:'in' };
  return null;
}

function boxCuFtFromInches(h,w,d){
  const cuft = round2(inchToFt(h)*inchToFt(w)*inchToFt(d));
  return Math.max(1, cuft); // Minimum 1 cubic foot
}

function cylinderCuFt(lengthIn, diameterIn){
  const rft = inchToFt(diameterIn)/2;
  const lenft = inchToFt(lengthIn);
  return round2(Math.PI * rft*rft * lenft);
}

function cmToInches(cm) {
  return cm / 2.54;
}

function kgToPounds(kg) {
  return kg * 2.20462;
}

function normalizeDimensions(raw) {
  if (!raw) return null;

  const result = {
    length: null,
    width: null,
    height: null,
    weight: null,
    boxesPerUnit: raw.boxesPerUnit || raw.boxes_per_unit || 1
  };

  let length = toNum(raw.length || raw.L || raw.box_length_in || 0);
  let width = toNum(raw.width || raw.W || raw.box_width_in || 0);
  let height = toNum(raw.height || raw.H || raw.box_height_in || 0);
  let weight = toNum(raw.weight || raw.lb || raw.box_weight_lb || 0);

  const unit = (raw.unit || raw.dimension_unit || '').toLowerCase();
  const weightUnit = (raw.weightUnit || raw.weight_unit || '').toLowerCase();

  if (unit.includes('cm') || unit.includes('centimeter')) {
    length = length ? cmToInches(length) : null;
    width = width ? cmToInches(width) : null;
    height = height ? cmToInches(height) : null;
  }

  if (weightUnit.includes('kg') || weightUnit.includes('kilogram')) {
    weight = weight ? kgToPounds(weight) : null;
  }

  if (length > 0 && length < 500) result.length = length;
  if (width > 0 && width < 500) result.width = width;
  if (height > 0 && height < 500) result.height = height;
  if (weight > 0 && weight < 1000) result.weight = weight;

  return result;
}

function extractDimensionsFromZyte(zyteData) {
  const observations = [];

  if (zyteData.packageDimensions) {
    const dims = normalizeDimensions({
      length: zyteData.packageDimensions.length,
      width: zyteData.packageDimensions.width,
      height: zyteData.packageDimensions.height,
      weight: zyteData.packageDimensions.weight,
      unit: zyteData.packageDimensions.unit,
      weightUnit: zyteData.packageDimensions.weightUnit,
      boxesPerUnit: zyteData.packageDimensions.boxesPerUnit
    });

    if (dims && (dims.length || dims.width || dims.height)) {
      observations.push({
        source: 'zyte',
        ...dims,
        confLevel: 0.90
      });
    }
  }

  if (zyteData.dimensions && !zyteData.packageDimensions) {
    const dims = normalizeDimensions({
      length: zyteData.dimensions.length,
      width: zyteData.dimensions.width,
      height: zyteData.dimensions.height,
      weight: zyteData.weight,
      unit: zyteData.dimensions.unit,
      weightUnit: zyteData.weightUnit,
      boxesPerUnit: 1
    });

    if (dims && (dims.length || dims.width || dims.height)) {
      observations.push({
        source: 'zyte',
        ...dims,
        confLevel: 0.60
      });
    }
  }

  if (zyteData.additionalProperties && Array.isArray(zyteData.additionalProperties)) {
    const propMap = {};
    zyteData.additionalProperties.forEach(prop => {
      if (prop.name && prop.value) {
        propMap[prop.name.toLowerCase()] = prop.value;
      }
    });

    const shippingDims = propMap['shipping dimensions'] || propMap['package dimensions'];
    if (shippingDims) {
      const parsed = parseDimsInches(shippingDims);
      if (parsed) {
        observations.push({
          source: 'zyte',
          length: parsed.h,
          width: parsed.w,
          height: parsed.d,
          weight: null,
          boxesPerUnit: 1,
          confLevel: 0.85
        });
      }
    }
  }

  return observations;
}

function calculateCubicFeet(length, width, height, boxesPerUnit = 1) {
  if (!length || !width || !height) return 0;
  return round2((length * width * height) / 1728 * boxesPerUnit);
}

function validateDimensions(dims) {
  const errors = [];

  if (dims.length !== null && dims.length !== undefined) {
    if (dims.length <= 0) errors.push('Length must be positive');
    if (dims.length > 200) errors.push('Length exceeds maximum (200 inches)');
  }

  if (dims.width !== null && dims.width !== undefined) {
    if (dims.width <= 0) errors.push('Width must be positive');
    if (dims.width > 200) errors.push('Width exceeds maximum (200 inches)');
  }

  if (dims.height !== null && dims.height !== undefined) {
    if (dims.height <= 0) errors.push('Height must be positive');
    if (dims.height > 200) errors.push('Height exceeds maximum (200 inches)');
  }

  if (dims.weight !== null && dims.weight !== undefined) {
    if (dims.weight <= 0) errors.push('Weight must be positive');
    if (dims.weight > 500) errors.push('Weight exceeds maximum (500 pounds)');
  }

  return errors;
}

module.exports = {
  toNum,
  inchToFt,
  round2,
  parseDimsInches,
  boxCuFtFromInches,
  cylinderCuFt,
  cmToInches,
  kgToPounds,
  normalizeDimensions,
  extractDimensionsFromZyte,
  calculateCubicFeet,
  validateDimensions
};
