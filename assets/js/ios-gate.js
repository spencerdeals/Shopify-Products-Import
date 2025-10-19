(function () {
  // Robust iOS detection (covers iPhone/iPad/iPod + iPadOS desktop UA)
  var ua = navigator.userAgent || '';
  var plat = navigator.platform || '';
  var isTouchMac = /Mac/.test(ua) && 'ontouchend' in document;
  var isIOS = /iP(hone|ad|od)/i.test(plat) || /iPhone|iPad|iPod/i.test(ua) || isTouchMac;
  if (!isIOS) return; // EXIT for desktop + Android

  // Mark document so CSS can scope to iOS only
  document.documentElement.classList.add('ios');

  // 1) Ensure the PAGE owns scroll on iOS
  try {
    document.documentElement.style.overflowY = 'auto';
    document.documentElement.style.overflowX = 'hidden';
    document.body.style.overflowY = 'auto';
    document.body.style.overflowX = 'hidden';
    document.body.style.webkitOverflowScrolling = 'touch';
  } catch(e){}

  // 2) Unlock common host/theme wrappers on iOS only
  var UNLOCK_SELECTORS = [
    '#imports-root', '#MainContent', '#app',
    '.content-for-layout', '.page-width', '.container'
  ];

  function unlockContainers(root) {
    UNLOCK_SELECTORS.forEach(function (sel) {
      root.querySelectorAll(sel).forEach(function (el) {
        el.style.overflow = 'visible';
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        el.style.contain = 'none';
      });
    });

    // Convert inline 100vh traps to growth-friendly height
    root.querySelectorAll('[style*="100vh"]').forEach(function (el) {
      el.style.height = 'auto';
      el.style.minHeight = '100dvh';
      el.style.overflow = 'visible';
    });
  }

  // 3) Make global scroll listeners passive so nobody can block page scroll
  ['touchmove','wheel'].forEach(function (evt) {
    window.addEventListener(evt, function(){}, { passive: true, capture: true });
  });

  // 4) Ensure there is real content AFTER the main section so iOS can scroll past the fold
  //    Insert a spacer near the bottom if missing
  function ensureBottomReachable() {
    var spacerId = 'ios-bottom-spacer';
    if (!document.getElementById(spacerId)) {
      var spacer = document.createElement('div');
      spacer.id = spacerId;
      spacer.style.height = 'clamp(40px, 8vh, 120px)';
      spacer.style.width = '100%';
      spacer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(spacer);
    }
  }

  // Run now and watch for DOM changes
  var run = function() {
    unlockContainers(document);
    ensureBottomReachable();
  };

  run();

  // Watch for dynamic content (React/Vue hydration)
  new MutationObserver(run).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class']
  });
})();
