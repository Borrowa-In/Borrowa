// Mobile navigation: on phones the whole top bar collapses into a hamburger
// that opens a slide-out menu on the LEFT. It holds every nav item (pages,
// Dashboard for admins, profile + rank, Lend item, Sign in / Log out).
//
// It is built from the real nav on each open, so it always matches what the
// page shows (admin link, logged-in name, rank, Log out) without duplicating
// any logic. Menu buttons simply "click" the real ones, so existing handlers
// (Lend item, Log out...) keep working. Desktop is untouched.
(function () {
  var nav = document.querySelector("nav.nav");
  if (!nav) return;
  var inner = nav.querySelector(".nav-inner");
  var links = nav.querySelector(".nav-links");
  var actions = nav.querySelector(".nav-actions");
  if (!inner || (!links && !actions)) return; // brand-only bars need no menu

  nav.classList.add("mnav-on");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var ICONS = { "home.html": "🏠", "requests.html": "🙋", "leaderboard.html": "🏆", "chat.html": "💬", "admin.html": "🛡️", "moderator.html": "🛡️", "index.html": "🏠" };
  function iconFor(href) {
    var f = String(href || "").split("?")[0].split("/").pop();
    return ICONS[f] || "•";
  }

  // --- hamburger (left of the logo) ---
  var burger = document.createElement("button");
  burger.type = "button";
  burger.className = "mnav-burger";
  burger.setAttribute("aria-label", "Open menu");
  burger.setAttribute("aria-expanded", "false");
  burger.innerHTML = "<span></span><span></span><span></span>";
  inner.insertBefore(burger, inner.firstChild);

  // --- overlay + drawer (on <body> so nothing in the nav can clip it) ---
  var overlay = document.createElement("div");
  overlay.className = "mnav-overlay";
  var drawer = document.createElement("aside");
  drawer.className = "mnav-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  drawer.setAttribute("aria-label", "Menu");
  drawer.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  function build() {
    var html = "";
    var brandEl = nav.querySelector(".brand");
    var brandHref = (brandEl && brandEl.getAttribute("href")) || "index.html";
    html += '<div class="mnav-head"><a class="mnav-brand" href="' + esc(brandHref) + '"><span class="brand-mark">B</span> Borrowa</a>' +
            '<button type="button" class="mnav-close" aria-label="Close menu">×</button></div>';

    // Signed-in profile card
    var slot = document.getElementById("nav-profile-slot");
    var nameEl = slot && slot.querySelector(".nav-profile-dropdown-name");
    var profileLinks = [];
    if (nameEl) {
      var name = nameEl.textContent || "Neighbor";
      var tierEl = nameEl.nextElementSibling;
      var tierHtml = tierEl && tierEl.querySelector("span") ? tierEl.innerHTML : "";
      html += '<div class="mnav-profile"><span class="mnav-avatar">' + esc(name.trim().charAt(0).toUpperCase() || "?") + '</span>' +
              '<div class="mnav-profile-text"><div class="mnav-name">' + esc(name) + '</div>' +
              (tierHtml ? '<div class="mnav-tier">' + tierHtml + '</div>' : "") + '</div></div>';
      slot.querySelectorAll(".nav-profile-dropdown-link").forEach(function (a) {
        profileLinks.push({ href: a.getAttribute("href"), text: a.textContent.replace(/\s*→\s*$/, "") });
      });
    }

    // Page links (includes the admin Dashboard link when present)
    html += '<nav class="mnav-list" aria-label="Pages">';
    if (links) {
      links.querySelectorAll("a").forEach(function (a) {
        var href = a.getAttribute("href") || "#";
        var here = a.classList.contains("active");
        html += '<a class="mnav-item' + (here ? " active" : "") + (a.id === "nav-admin-dashboard-btn" ? " admin" : "") + '" href="' + esc(href) + '"><span class="mnav-ico">' + iconFor(href) + "</span>" + esc(a.textContent.trim()) + "</a>";
      });
    }
    profileLinks.forEach(function (p) {
      html += '<a class="mnav-item sub" href="' + esc(p.href) + '"><span class="mnav-ico">›</span>' + esc(p.text) + "</a>";
    });
    html += "</nav>";

    // Action buttons (Lend item, Sign in, Sign up, Log out): proxy to the real ones
    html += '<div class="mnav-actions">';
    var proxies = [];
    if (actions) {
      Array.prototype.forEach.call(actions.children, function (el) {
        if (el.id === "nav-profile-slot") return;
        if (!/^(BUTTON|A)$/.test(el.tagName)) return;
        if (getComputedStyle(el).display === "none") return;
        var primary = el.classList.contains("btn-primary");
        proxies.push(el);
        var label = el.textContent.trim();
        if (el.id === "notif-bell-btn") {
          // The bell only holds an icon and an unread count: give it a real name in the menu.
          var count = label.replace(/\D+/g, "");
          label = "\u{1F514} Notifications" + (count ? " (" + count + ")" : "");
        }
        html += '<button type="button" class="mnav-btn ' + (primary ? "primary" : "outline") + '" data-i="' + (proxies.length - 1) + '">' + esc(label) + "</button>";
      });
    }
    html += "</div>";
    drawer.innerHTML = html;

    drawer.querySelector(".mnav-close").addEventListener("click", close);
    drawer.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", close); });
    drawer.querySelectorAll(".mnav-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var target = proxies[Number(b.getAttribute("data-i"))];
        close();
        if (target) setTimeout(function () { target.click(); }, 120);
      });
    });
  }

  var isOpen = false;
  function open() {
    build();
    isOpen = true;
    drawer.classList.add("open");
    overlay.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    burger.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("mnav-lock");
    var first = drawer.querySelector(".mnav-item, .mnav-btn");
    if (first) first.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    drawer.classList.remove("open");
    overlay.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    burger.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("mnav-lock");
    burger.focus({ preventScroll: true });
  }

  burger.addEventListener("click", function () { isOpen ? close() : open(); });
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  window.addEventListener("resize", function () { if (window.innerWidth > 768) close(); });

  // Swipe left on the menu to close it
  var sx = null;
  drawer.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
  drawer.addEventListener("touchend", function (e) {
    if (sx !== null && e.changedTouches[0].clientX - sx < -60) close();
    sx = null;
  }, { passive: true });
})();
