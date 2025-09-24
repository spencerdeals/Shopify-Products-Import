"use strict";

/**
 * Robust retailer detection from URL or hostname.
 */
function detectRetailerFromUrl(urlOrHost = "") {
  if (!urlOrHost) return "";
  let hostname = "";
  try {
    if (/^https?:\/\//i.test(urlOrHost)) {
      hostname = new URL(urlOrHost).hostname;
    } else {
      hostname = new URL(`https://${urlOrHost}`).hostname;
    }
  } catch (_) {
    hostname = String(urlOrHost || "");
  }
  const h = (hostname || "").toLowerCase();

  if (h.includes("wayfair")) return "Wayfair";
  if (h.includes("potterybarn")) return "Pottery Barn";
  if (h.includes("walmart")) return "Walmart";
  if (h.includes("target")) return "Target";
  if (h.includes("ikea")) return "IKEA";
  if (h.includes("amazon")) return "Amazon";
  return "";
}

module.exports = { detectRetailerFromUrl };