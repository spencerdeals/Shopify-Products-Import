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

module.exports = { toNum, inchToFt, round2, parseDimsInches, boxCuFtFromInches, cylinderCuFt };
