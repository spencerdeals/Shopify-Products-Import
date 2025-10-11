const { parseDimsInches, boxCuFtFromInches, cylinderCuFt } = require("./dimensionUtils");

function lc(x){ return (x||"").toString().toLowerCase(); }
function joinText(p){
  const parts = [
    p.title,p.name,p.category,p.breadcrumbs,p.description,p.descriptionHtml,
    JSON.stringify(p.additionalProperties||{}),
    Array.isArray(p.variants)?p.variants.join(" "):""
  ].filter(Boolean);
  return lc(parts.join(" | "));
}
function pickSize(raw){
  const s = lc(raw||"");
  if(s.includes("cal")) return "calking";
  if(s.includes("king")) return "king";
  if(s.includes("queen")||s==="q") return "queen";
  if(s.includes("full")||s.includes("double")) return "full";
  if(s.includes("twin")) return "twin";
  return null;
}
function parseThicknessIn(raw){
  const m = String(raw||"").match(/(\d+(?:\.\d+)?)\s*(?:in|[""]?)/i);
  return m ? parseFloat(m[1]) : null;
}

const BASE_MATTRESS = {
  foam:   { twin:5, full:6, queen:7.5, king:9,   calking:9.5 },
  hybrid: { twin:6, full:7, queen:8.5, king:10,  calking:10.5 }
};
function mattressCuFt(p){
  const t = joinText(p);
  if(!/mattress/.test(t) && !/(compressed\s+in\s+a\s+box|bed[-\s]?in[-\s]?a[-\s]?box|boxed)/.test(t)) return null;
  const type = /hybrid|pocket\s*coil|innerspring/.test(t) ? "hybrid":"foam";
  const size = pickSize(p.size) || pickSize(p.additionalProperties?.["mattress size"]) ||
               pickSize(p.additionalProperties?.mattress_size) ||
               pickSize(Array.isArray(p.variants)&&p.variants.join(" ")) || "queen";
  const thickness = parseThicknessIn(p.additionalProperties?.["mattress thickness"]) ||
                    parseThicknessIn(p.additionalProperties?.mattress_thickness) ||
                    parseThicknessIn(p.description) ||
                    parseThicknessIn(p.title) || 12;
  const base = BASE_MATTRESS[type][size];
  const adj = Math.max(0, thickness-12)*0.2;
  const cuft = Math.min(base+adj, base+1.5);
  return { cuft: Math.round(cuft*10)/10, meta:{type,size,thickness} };
}

function beddingCuFt(p){
  const t = joinText(p);
  if(!/(duvet|comforter|quilt|insert|sham|pillowcase)/.test(t)) return null;
  if(/duvet.*cover|cover only|duvet cover/.test(t)) return { cuft: 1.0, meta:{kind:"duvet cover"} };
  if(/sham/.test(t)) return { cuft: 1.0, meta:{kind:"sham"} };
  const size = pickSize(p.size) || pickSize(p.additionalProperties?.size) || "queen";
  const base = { twin:1.8, full:2.2, queen:2.6, king:3.1, calking:3.3 };
  let cuft = base[size] || 2.6;
  if(/light\s*weight|lightweight|summer/.test(t)) cuft -= 0.3;
  if(/heavy|winter|extra\s*warm/.test(t)) cuft += 0.4;
  return { cuft: Math.max(1.0, Math.round(cuft*10)/10), meta:{kind:"comforter",size} };
}

function bedFlatpackCuFt(p){
  const t = joinText(p);
  if(!/(bed|headboard)/.test(t)) return null;
  const dims = p.dimensionsInches || parseDimsInches(t);
  if(dims){
    const cu = boxCuFtFromInches(dims.h,dims.w,dims.d);
    if(cu>2) return { cuft: cu, meta:{method:"explicit_dims"} };
  }
  const size = pickSize(p.size) || pickSize(p.additionalProperties?.size) || "queen";
  const table = { twin:10, full:12, queen:16, king:20, calking:21 };
  return { cuft: table[size], meta:{kind:"bed_flatpack",size} };
}

function diningTableFlatpackCuFt(p){
  const t = joinText(p);
  if(!/(dining\s*table|table)/.test(t)) return null;
  const d = p.dimensionsInches || parseDimsInches(t);
  if(d){
    const top = boxCuFtFromInches(d.h,d.w,Math.max(2,d.d));
    const legs = 3;
    return { cuft: Math.max(6, Math.round((top+legs)*10)/10), meta:{method:"explicit_dims"} };
  }
  if(/(84|96)/.test(t)) return { cuft: 16, meta:{len:"84-96"} };
  if(/72/.test(t)) return { cuft: 14, meta:{len:72} };
  if(/60/.test(t)) return { cuft: 11, meta:{len:60} };
  if(/48/.test(t)) return { cuft: 9,  meta:{len:48} };
  return { cuft: 10, meta:{method:"default"} };
}

function rugCuFt(p){
  const t = joinText(p);
  if(!/rug/.test(t)) return null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*(?:ft|feet|'|'))/);
  if(m){
    const wft = parseFloat(m[1]), lft = parseFloat(m[2]);
    const diamIn = /thick|plush|shag/.test(t) ? 12 : 9.5;
    const lenIn  = Math.max(36, lft*12);
    const cu = cylinderCuFt(lenIn, diamIn);
    return { cuft: Math.max(1.5, cu), meta:{diamIn, lenIn} };
  }
  return { cuft: 2.2, meta:{method:"default"} };
}

function mirrorGlassArtCuFt(p){
  const t = joinText(p);
  if(!/(mirror|glass|framed art|wall art|glass top|glass door)/.test(t)) return null;
  const d = p.dimensionsInches || parseDimsInches(t);
  if(d){
    const cu = boxCuFtFromInches(d.h,d.w,Math.max(2.5,d.d||2));
    return { cuft: Math.max(2, cu), meta:{method:"explicit_dims"} };
  }
  return { cuft: 3.5, meta:{method:"default"} };
}

function sofaCuFt(p){
  const t = joinText(p);
  if(!/(sofa|sectional|loveseat|couch)/.test(t)) return null;
  if(/sectional/.test(t)) return { cuft: 55, meta:{kind:"sectional"} };
  if(/loveseat/.test(t))  return { cuft: 35, meta:{kind:"loveseat"} };
  return { cuft: 45, meta:{kind:"sofa"} };
}

function casegoodCuFt(p){
  const t = joinText(p);
  if(!/(dresser|credenza|sideboard|buffet|chest|nightstand|bookcase|cabinet|hutch)/.test(t)) return null;
  const d = p.dimensionsInches || parseDimsInches(t);
  if(d){
    return { cuft: Math.max(6, boxCuFtFromInches(d.h,d.w,Math.max(16,d.d)) ), meta:{method:"explicit_dims"} };
  }
  return { cuft: 18, meta:{method:"default"} };
}

function lightingCuFt(p){
  const t = joinText(p);
  if(!/(pendant|chandelier|sconce|table lamp|floor lamp|flush mount|ceiling light)/.test(t)) return null;
  if(/(chandelier|multi[-\s]?light)/.test(t)) return { cuft: 8,  meta:{kind:"chandelier"} };
  if(/pendant/.test(t))     return { cuft: 3.5, meta:{kind:"pendant"} };
  if(/sconce/.test(t))      return { cuft: 1.2, meta:{kind:"sconce"} };
  if(/table lamp/.test(t))  return { cuft: 2.2, meta:{kind:"table lamp"} };
  if(/floor lamp/.test(t))  return { cuft: 4.5, meta:{kind:"floor lamp"} };
  return { cuft: 3, meta:{kind:"light"} };
}

function seatingCuFt(p){
  const t = joinText(p);
  if(!/(chair|stool|barstool|counter stool|office chair|desk chair)/.test(t)) return null;
  if(/office/.test(t)) return { cuft: 9, meta:{kind:"office chair"} };
  if(/barstool|counter stool/.test(t)) return { cuft: 7, meta:{kind:"stool"} };
  return { cuft: 8, meta:{kind:"chair"} };
}

function outdoorCuFt(p){
  const t = joinText(p);
  if(!/(outdoor|patio|terrace|garden)/.test(t)) return null;
  if(/umbrella/.test(t)) return { cuft: 3.5, meta:{kind:"umbrella"} };
  if(/dining\s*set/.test(t)) return { cuft: 38, meta:{kind:"outdoor dining set"} };
  if(/sofa|sectional/.test(t)) return { cuft: 50, meta:{kind:"outdoor sofa"} };
  if(/lounger|chaise/.test(t)) return { cuft: 20, meta:{kind:"chaise"} };
  return { cuft: 10, meta:{kind:"outdoor"} };
}

function applianceCuFt(p){
  const t = joinText(p);
  if(!/(refrigerator|fridge|range|stove|oven|dishwasher|washer|dryer|microwave)/.test(t)) return null;
  if(/refrigerator|fridge/.test(t)) return { cuft: 60, meta:{kind:"fridge"} };
  if(/range|stove|oven/.test(t))    return { cuft: 40, meta:{kind:"range/oven"} };
  if(/dishwasher/.test(t))          return { cuft: 25, meta:{kind:"dishwasher"} };
  if(/washer|dryer/.test(t))        return { cuft: 35, meta:{kind:"laundry"} };
  return { cuft: 12, meta:{kind:"appliance"} };
}

function tvElectronicsCuFt(p){
  const t = joinText(p);
  if(!/(tv|television|monitor)/.test(t)) return null;
  if(/85|82|83/.test(t)) return { cuft: 9,  meta:{size:"80s"} };
  if(/77|75/.test(t))    return { cuft: 7.5,meta:{size:"70s"} };
  if(/65|66|67/.test(t)) return { cuft: 6,  meta:{size:"65"} };
  if(/55/.test(t))       return { cuft: 5,  meta:{size:"55"} };
  return { cuft: 4, meta:{size:"<55"} };
}

function gymCuFt(p){
  const t = joinText(p);
  if(!/(treadmill|elliptical|rowing machine|rower|spin bike|stationary bike|home gym)/.test(t)) return null;
  if(/treadmill|elliptical/.test(t)) return { cuft: 35, meta:{kind:"large gym"} };
  if(/rower|bike/.test(t))           return { cuft: 22, meta:{kind:"bike/rower"} };
  return { cuft: 15, meta:{kind:"gym"} };
}
function babyCuFt(p){
  const t = joinText(p);
  if(!/(stroller|car seat|crib|bassinet|high chair|playard)/.test(t)) return null;
  if(/crib/.test(t))  return { cuft: 14, meta:{kind:"crib"} };
  if(/stroller/.test(t)) return { cuft: 8, meta:{kind:"stroller"} };
  return { cuft: 5, meta:{kind:"baby"} };
}
function smallDecorCuFt(p){
  const t = joinText(p);
  if(!/(vase|frame|clock|candle holder|throw pillow|basket|tray)/.test(t)) return null;
  return { cuft: 1, meta:{kind:"small decor"} };
}

module.exports = {
  mattressCuFt,
  beddingCuFt,
  bedFlatpackCuFt,
  diningTableFlatpackCuFt,
  rugCuFt,
  mirrorGlassArtCuFt,
  sofaCuFt,
  casegoodCuFt,
  lightingCuFt,
  seatingCuFt,
  outdoorCuFt,
  applianceCuFt,
  tvElectronicsCuFt,
  gymCuFt,
  babyCuFt,
  smallDecorCuFt
};
