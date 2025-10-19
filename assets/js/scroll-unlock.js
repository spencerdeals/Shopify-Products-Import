(function () {
  // Force passive listeners at the top of the chain so rogue preventDefault won't block scroll
  ['touchmove','wheel'].forEach(evt => {
    window.addEventListener(evt, function(){}, { passive: true, capture: true });
  });

  // Remove global scroll locks added by libs (except inside true modals/drawers)
  const unblock = (root) => {
    const modalWhitelist = ['.modal','.drawer','.dialog','.popover','.dropdown-menu','.carousel'];
    const isWhitelisted = el => modalWhitelist.some(sel => el.closest(sel));
    root.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      const o = (cs.overflow + cs.overflowY + cs.overflowX).toLowerCase();
      if (!isWhitelisted(el)) {
        if (o.includes('hidden') || o.includes('scroll') || o.includes('auto')) {
          el.style.overflow = 'visible';
          el.style.maxHeight = '';
        }
        const inline = (el.getAttribute('style')||'');
        if (/height:\s*100vh/i.test(inline) || /height:\s*calc\(100vh/i.test(inline)) {
          el.style.height = 'auto';
          el.style.minHeight = '100dvh';
        }
      }
    });
  };

  // Run now and after DOM mutations
  const run = () => unblock(document);
  run();
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
})();
