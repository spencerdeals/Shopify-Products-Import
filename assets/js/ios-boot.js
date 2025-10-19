(function () {
  // Robust iOS detection (covers iPadOS with desktop UA)
  var ua = navigator.userAgent || '';
  var plat = navigator.platform || '';
  var isTouchMac = /Mac/.test(ua) && 'ontouchend' in document;
  var isIOS = /iP(hone|ad|od)/i.test(plat) || /iPhone|iPad|iPod/i.test(ua) || isTouchMac;
  if (!isIOS) return;

  // Mark document as iOS so CSS scoping kicks in
  document.documentElement.classList.add('ios');

  // Ensure page owns scroll (some libs set preventDefault)
  try {
    document.documentElement.style.overflowY = 'auto';
    document.body.style.overflowY = 'auto';
    document.body.style.overscrollBehavior = 'none';
  } catch (e) {}

  // Top-level passive listeners so rogue handlers can't block scroll
  ['touchmove','wheel'].forEach(function (evt) {
    window.addEventListener(evt, function(){}, { passive: true, capture: true });
  });

  // Unlock common host wrappers and fix inline 100vh traps
  function unlock(root) {
    var wrappers = [
      '#imports-root', '.content-for-layout', '.page-width',
      '.container', '#MainContent', '#app'
    ];
    wrappers.forEach(function (sel) {
      root.querySelectorAll(sel).forEach(function (el) {
        el.style.overflow = 'visible';
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        el.style.contain = 'none';
        el.style.maxWidth = '100vw';
      });
    });

    // Replace inline height:100vh / calc(100vh - x) on content elements
    root.querySelectorAll('[style]').forEach(function (el) {
      var s = el.getAttribute('style');
      if (!s) return;
      if (/height\s*:\s*100vh/i.test(s) || /height\s*:\s*calc\(\s*100vh/i.test(s)) {
        el.style.height = 'auto';
        el.style.minHeight = '100svh';
        el.style.overflow = 'visible';
      }
    });
  }

  // Guarantee we can scroll past the CTA: ensure a spacer exists near the end
  function ensureSpacer() {
    var id = 'ios-page-end-spacer';
    if (!document.getElementById(id)) {
      var spacer = document.createElement('div');
      spacer.className = 'page-end-spacer';
      spacer.id = id;
      document.body.appendChild(spacer);
    }
  }

  var run = function() {
    unlock(document);
    ensureSpacer();
  };

  // Run immediately
  run();

  // Re-run on DOM changes (handles SPA/hydration)
  new MutationObserver(run).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style','class']
  });
})();
