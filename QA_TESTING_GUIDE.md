# QA Testing Guide - Scroll Fix Implementation

## Quick Start
The scroll system has been completely refactored. This guide helps you verify everything works correctly.

---

## What Changed?
- **Before:** Nested scroll containers, iOS bounce issues, content trapped in theme containers
- **After:** Page-only scrolling, iOS-friendly viewport, full-bleed layout

---

## Testing Environments

### Required
- ✅ Desktop Browser (Chrome or Firefox)
- ✅ iOS Device (iPhone or iPad with Safari)
- ✅ Android Device (Chrome browser)

### Optional
- Desktop Safari
- Desktop Edge
- Android Firefox
- Shopify embedded environment

---

## Test 1: Desktop Browser (5 minutes)

### Steps:
1. Open https://[your-domain]/frontend/index.html in Chrome
2. Scroll from top to bottom of the intro page
3. Click "Get Your Quote Now"
4. On calculator page, add a product URL
5. Scroll through results

### Expected Results:
- [ ] No inner scrollbars appear (only browser's main scrollbar)
- [ ] No horizontal scrollbar at any window width
- [ ] Resizing window from mobile to desktop width works smoothly
- [ ] Bottom "Get Your Quote Now" button is visible without scrolling
- [ ] Calculator page scrolls smoothly
- [ ] Modals (if opened) scroll independently (this is correct)

### Red Flags:
- ❌ Two scrollbars (one inside the page) = FAIL
- ❌ Horizontal scrollbar = FAIL
- ❌ Content gets cut off when resizing = FAIL

---

## Test 2: iOS Safari (10 minutes) ⭐ CRITICAL

### Device Setup:
- Use real iPhone or iPad (Simulator doesn't replicate scroll physics)
- Open in Safari browser
- Ensure iOS is up to date

### Steps:
1. Navigate to calculator page
2. Slowly scroll from absolute top to absolute bottom
3. Try to "bounce" at the top edge (pull down)
4. Try to "bounce" at the bottom edge (pull up while at bottom)
5. Tap an input field
6. Scroll to bottom and try to tap "Get Your Quote Now"

### Expected Results:
- [ ] Smooth scroll from top to bottom, no "stuttering"
- [ ] When you release at top/bottom edge, page doesn't "ping back" (no bounce)
- [ ] Address bar collapses/expands as you scroll (dynamic viewport working)
- [ ] When address bar is collapsed, bottom CTA is still fully visible
- [ ] Tapping input field doesn't zoom the page in
- [ ] Bottom CTA button is tappable without the page bouncing away

### Red Flags:
- ❌ Page "stutters" or stops mid-scroll = FAIL
- ❌ Bounce "ping back" makes CTA hard to tap = FAIL (this was the main issue)
- ❌ Content hidden when address bar collapses = FAIL
- ❌ Page zooms in when typing = Minor (but annoying)
- ❌ Can't scroll to actual bottom = FAIL

---

## Test 3: Android Chrome (5 minutes)

### Steps:
1. Open calculator page
2. Scroll from top to bottom
3. Add a product and review results
4. Scroll to bottom CTA

### Expected Results:
- [ ] Single smooth scroll (no "scroll within scroll" feeling)
- [ ] Bottom CTA easily reachable
- [ ] No content cutoff

### Red Flags:
- ❌ Double-scroll behavior = FAIL
- ❌ Bottom CTA not reachable = FAIL

---

## Test 4: Modals (2 minutes)

### Steps:
1. Trigger the manual entry modal (when a product needs manual input)
2. If the modal content is long, scroll within it
3. Close modal

### Expected Results:
- [ ] Modal content scrolls independently (this is correct!)
- [ ] Page behind modal doesn't scroll when scrolling modal
- [ ] Modal can be closed normally

### Red Flags:
- ❌ Can't scroll modal content = FAIL
- ❌ Page scrolls when trying to scroll modal = FAIL

---

## Test 5: Shopify Embedded (Optional, 5 minutes)

### Steps:
1. View calculator embedded in Shopify theme
2. Verify layout uses full width
3. Scroll page

### Expected Results:
- [ ] Calculator breaks out of narrow theme container
- [ ] Full-width layout (edge-to-edge on mobile)
- [ ] Still has readable max-width on very wide screens

### Red Flags:
- ❌ Trapped in narrow column = Configuration issue (check CSS load order)

---

## Common Issues & Solutions

### Issue: Inner scrollbar visible
**Cause:** scroll-fix.css not loading or being overridden
**Solution:** Check that `<link>` tag is AFTER other CSS in `<head>`

### Issue: iOS bounce still happening
**Cause:** scroll-unlock.js not loading
**Solution:** Check that `<script>` tag is present before `</body>`

### Issue: Horizontal scrollbar
**Cause:** Some element wider than viewport
**Solution:** Inspect element, check for `width > 100vw` or missing `box-sizing: border-box`

### Issue: Content cut off on iOS
**Cause:** Fixed `100vh` not converted to `100dvh`
**Solution:** Check for inline styles with `height: 100vh`, should be removed

### Issue: Modal won't scroll
**Cause:** scroll-unlock.js removing modal scroll
**Solution:** Ensure modal has class `.modal`, `.drawer`, or `.dialog` (these are whitelisted)

---

## Performance Notes

### What's Normal:
- Smooth 60fps scrolling on all devices
- Instant page transitions
- No scroll jank or stuttering

### What's Not Normal:
- Laggy or stuttering scroll = JavaScript issue (check console)
- Page "jumps" when scrolling = CSS layout shift (check for elements without dimensions)

---

## Rollback Procedure

If critical issues found:

1. Remove `<link rel="stylesheet" href="/assets/css/scroll-fix.css">` from `<head>`
2. Remove `<script src="/assets/js/scroll-unlock.js"></script>` from before `</body>`
3. Restore previous CSS rules from git history
4. Deploy immediately
5. File detailed bug report

---

## Success Criteria

### Must Pass (Blocking):
- ✅ No nested scrollbars on desktop
- ✅ iOS: bottom CTA reachable without bounce
- ✅ iOS: no ping-back behavior
- ✅ Android: smooth single scroll

### Should Pass (Important):
- ✅ iOS: no zoom on input focus
- ✅ Full-width layout in Shopify
- ✅ Modal scrolling works correctly

### Nice to Have:
- ✅ Smooth 60fps scroll on all devices
- ✅ No console errors

---

## Reporting

### If Tests Pass:
✅ Reply: "QA PASS - All scroll tests successful on [device list]"

### If Tests Fail:
1. Note which test(s) failed
2. Take screenshots/video if possible
3. Check browser console for errors
4. Report: "QA FAIL - [Test Name] failed on [Device/Browser] - [Description]"

---

## Questions?

### Why no changes to visuals?
This is a layout/scroll-only refactor. All colors, fonts, text unchanged.

### Why are modals still scrollable?
That's correct! Modals need their own scroll. Only the page content doesn't nest scrolls.

### Why test on real iOS device?
iOS Simulator doesn't accurately replicate scroll physics, bounce behavior, or dynamic viewport.

---

**Last Updated:** 2025-10-14
**Estimated Testing Time:** 25 minutes (all tests)
**Critical Test:** iOS Safari (Test 2)
