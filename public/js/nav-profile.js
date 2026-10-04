// Small profile dropdown in the top-right of the nav: avatar initial, the
// member's name, rank tier and quick links. Members are ranked by how
// actively they take part; see ranks.js and leaderboard.html.
import { tierBadgeHtml } from "./ranks.js";

export function renderNavProfileButton({ name, tier, points }) {
  const slot = document.getElementById("nav-profile-slot");
  if (!slot) return;

  const displayName = name || "Neighbor";
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  slot.style.display = "block";
  slot.innerHTML = `
    <div class="nav-profile">
      <button type="button" id="nav-profile-btn" class="nav-profile-btn" aria-haspopup="true" aria-expanded="false">
        <span class="nav-profile-avatar"${tier ? ` style="box-shadow:0 0 0 2px ${tier.border};"` : ""}>${escapeHtml(initial)}</span>
        <span class="nav-profile-caret">▾</span>
      </button>
      <div id="nav-profile-dropdown" class="nav-profile-dropdown" style="display:none;">
        <div class="nav-profile-dropdown-name">${escapeHtml(displayName)}</div>
        ${tier ? `<div style="margin:4px 0 8px;display:flex;align-items:center;gap:6px;">${tierBadgeHtml(tier, true)}<span style="font-size:11px;color:#6b7280;">${points || 0} pts</span></div>` : ""}
        <a class="nav-profile-dropdown-link" href="requests.html">My borrow requests →</a>
        <a class="nav-profile-dropdown-link" href="leaderboard.html" style="margin-top:6px;">See my ranking →</a>
      </div>
    </div>
  `;

  const btn = document.getElementById("nav-profile-btn");
  const dropdown = document.getElementById("nav-profile-dropdown");
  if (!btn || !dropdown) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== "none";
    dropdown.style.display = isOpen ? "none" : "block";
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!slot.contains(e.target)) dropdown.style.display = "none";
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
