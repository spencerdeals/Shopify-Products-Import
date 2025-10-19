(function () {
  // Robust iOS detection (covers iPhone, iPad, iPod, including iPadOS with desktop UA)
  var ua = window.navigator.userAgent || '';
  var plat = window.navigator.platform || '';
  var isTouchMac = /Mac/.test(ua) && 'ontouchend' in document;
  var isIOS = /iP(hone|ad|od)/i.test(plat) || /iPhone|iPad|iPod/i.test(ua) || isTouchMac;
  if (!isIOS) return;

  // Mark document as iOS so CSS can scope safely
  document.documentElement.classList.add('ios');

  // Ensure the PAGE owns scroll on iOS
  try {
    document.documentElement.style.overflowY = 'auto';
    document.body.style.overflowY = 'auto';
    document.body.style.overscrollBehavior = 'none';
  } catch (e) {}

  // Unlock common theme wrappers (Shopify-like) and our app roots
  function unlock(root) {
    var targets = [
      '.content-for-layout', '.page-width', '.container',
      '#MainContent', '#app', '#imports-root'
    ];
    targets.forEach(function (sel) {
      root.querySelectorAll(sel).forEach(function (el) {
        el.style.overflow = 'visible';
        el.style.maxHeight = 'none';
        el.style.height = 'auto';
        el.style.contain = 'none';
      });
    });

    // Convert inline 100vh traps to min-height growth
    root.querySelectorAll('[style*="100vh"]').forEach(function (el) {
      el.style.height = 'auto';
      el.style.minHeight = '100dvh';
      el.style.overflow = 'visible';
    });
  }

  // Run immediately and keep fixing if DOM changes (apps that hydrate late)
  var run = function(){ unlock(document); };
  run();
  new MutationObserver(run).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['style','class']
  });

  // Make scroll listeners passive at top-level so rogue preventDefault won't block page scroll
  ['touchmove','wheel'].forEach(function (evt) {
    window.addEventListener(evt, function(){}, { passive: true, capture: true });
  });
})();
