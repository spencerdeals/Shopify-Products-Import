function lc(x){ return (x||"").toString().toLowerCase(); }

function domainFromUrl(u){
  try { return new URL(u).hostname.replace(/^www\./,'').toLowerCase(); } catch { return null; }
}

function classifyRetailer(product, env=process.env){
  const hi = (env.FREIGHT_HIGH_END_LIST||"").split(",").map(s=>s.trim()).filter(Boolean);
  const lo = (env.FREIGHT_VALUE_LIST||"").split(",").map(s=>s.trim()).filter(Boolean);

  const url = product.canonicalUrl || product.url || product.sourceUrl || "";
  const host = domainFromUrl(url);

  const brand = lc(product.brand?.name || product.brand || "");
  const crumbs = lc(product.breadcrumbs||"");
  const title = lc(product.title||product.name||"");

  let tier = "neutral";
  const allText = [host, brand, crumbs, title].join(" ");
  if(hi.some(d => (host||"").includes(d) || allText.includes(d.split(".")[0]))) tier = "high";
  else if(lo.some(d => (host||"").includes(d) || allText.includes(d.split(".")[0]))) tier = "value";

  return { tier, host };
}

module.exports = { classifyRetailer, domainFromUrl };
