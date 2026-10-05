// Paints the signed-in parts of the nav (profile menu, log-out button,
// admin Dashboard link) from the last-known state the moment a page opens.
// Before this, those bits only appeared after Firebase Auth + a Firestore read
// finished, so the nav visibly "popped in" on every page change. main.js keeps
// the cache current and corrects it if the real state turns out different.
import { renderNavProfileButton } from "./nav-profile.js";
import { tierByKey, TIERS } from "./ranks.js";

const KEY = "borrowa_nav_v1";

export function saveNavCache(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}
export function clearNavCache() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}

function readNavCache() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; }
}

(function paintFromCache() {
  const c = readNavCache();
  if (!c || !c.name) return;
  const tier = tierByKey(c.tierKey) || TIERS[0];
  renderNavProfileButton({ name: c.name, tier, points: c.points || 0 });
  const logout = document.getElementById("logout-btn");
  if (logout) logout.style.display = "inline-block";
  const links = document.querySelector(".nav-links");
  if (c.admin && links && !document.getElementById("nav-admin-dashboard-btn")) {
    const a = document.createElement("a");
    a.id = "nav-admin-dashboard-btn";
    a.href = "admin.html";
    a.textContent = "Dashboard";
    a.style.cssText = "color: #14632f; text-decoration: none; font-weight: 650; background: #d3f5df; padding: 6px 12px; border-radius: 6px; display: inline-flex; align-items: center;";
    links.appendChild(a);
  }
  if (c.mod && links && !document.getElementById("nav-moderator-btn")) {
    const m = document.createElement("a");
    m.id = "nav-moderator-btn";
    m.href = "moderator.html";
    m.textContent = "Moderation";
    m.style.cssText = "color: #fff; text-decoration: none; font-weight: 650; background: linear-gradient(135deg,#3730a3,#0e7490); padding: 6px 12px; border-radius: 6px; display: inline-flex; align-items: center;";
    links.appendChild(m);
  }
})();
