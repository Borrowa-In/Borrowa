// Warms up the next page before you click it: hovering/touching a link to
// another page of the site (and, once the browser is idle, the main nav
// pages) downloads that page in the background, so the switch is near-instant.
(function () {
  var done = {};
  function warm(href) {
    if (!href || done[href]) return;
    done[href] = 1;
    var l = document.createElement("link");
    l.rel = "prefetch";
    l.href = href;
    l.as = "document";
    document.head.appendChild(l);
  }
  function local(a) {
    if (!a || !a.href || a.origin !== location.origin) return null;
    if (!/\.html$/.test(a.pathname) || a.pathname === location.pathname) return null;
    return a.pathname.split("/").pop() + a.search;
  }
  function onIntent(e) {
    var a = e.target.closest && e.target.closest("a");
    var h = local(a);
    if (h) warm(h);
  }
  document.addEventListener("pointerover", onIntent, { passive: true });
  document.addEventListener("touchstart", onIntent, { passive: true });
  var idle = window.requestIdleCallback || function (f) { setTimeout(f, 1500); };
  idle(function () {
    document.querySelectorAll(".nav-links a").forEach(function (a) { var h = local(a); if (h) warm(h); });
  });
})();
