"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { detectRetailerFromUrl } from "../server/utils/retailer.mjs";

test("detects Wayfair from full URL", () => {
  assert.equal(
    detectRetailerFromUrl("https://www.wayfair.com/furniture/pdp/whatever"),
    "Wayfair"
  );
});

test("detects Pottery Barn from hostname", () => {
  assert.equal(detectRetailerFromUrl("www.potterybarn.com"), "Pottery Barn");
});

test("returns empty string for unknown", () => {
  assert.equal(detectRetailerFromUrl("example.com"), "");
});

test("handles malformed URLs gracefully", () => {
  assert.equal(detectRetailerFromUrl("not-a-url"), "");
});

test("detects Amazon from subdomain", () => {
  assert.equal(detectRetailerFromUrl("https://smile.amazon.com/product"), "Amazon");
});

test("detects Target from hostname only", () => {
  assert.equal(detectRetailerFromUrl("target.com"), "Target");
});

test("handles empty input", () => {
  assert.equal(detectRetailerFromUrl(""), "");
  assert.equal(detectRetailerFromUrl(null), "");
  assert.equal(detectRetailerFromUrl(undefined), "");
});