import { guardAdminPage, logOut } from "./auth.js";
import { setDevicesBanned } from "./device.js";
import { db, auth, ADMIN_EMAIL } from "./firebase-config.js";
import {
  collection,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { buildUnclaimUpdate, buildForceClaimUpdate, resolveQuantityTotal } from "./item-status.js";
import { isIpBanned, banIp, unbanIp } from "./ip-guard.js";
import { TIERS, tierByKey, publishLeaderboard, leaderboardUpdatedAt } from "./ranks.js";

// Local state arrays to allow real-time filtering
let allListingsCache = [];
let allUsersCache = [];

document.addEventListener("DOMContentLoaded", () => {
  guardAdminPage((user) => {
    initAdminDashboard();
  });

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.style.display = "inline-flex";
    logoutBtn.addEventListener("click", async () => {
      await logOut();
      window.location.href = "login.html";
    });
  }

  // Tab switching logic
  const tabBtns = document.querySelectorAll(".tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const targetTab = btn.getAttribute("data-tab");
      document.querySelectorAll(".admin-tab-content").forEach((tab) => {
        tab.style.display = tab.id === targetTab ? "block" : "none";
      });
    });
  });

  // Search filter bindings
  const searchListingsInput = document.getElementById("search-listings");
  if (searchListingsInput) {
    searchListingsInput.addEventListener("input", (e) => {
      renderListingsTable(filterListings(e.target.value));
    });
  }

  const searchUsersInput = document.getElementById("search-users");
  if (searchUsersInput) {
    searchUsersInput.addEventListener("input", (e) => {
      renderUsersTable(filterUsers(e.target.value));
    });
  }

  // Modal close wiring for edit form
  const editModal = document.getElementById("admin-edit-modal");
  const closeEditModal = () => { if (editModal) editModal.style.display = "none"; };
  
  document.getElementById("admin-edit-close")?.addEventListener("click", closeEditModal);
  document.getElementById("admin-edit-cancel")?.addEventListener("click", closeEditModal);

  // Modal close wiring for the user editor
  const editUserModal = document.getElementById("admin-edit-user-modal");
  const closeEditUserModal = () => { if (editUserModal) editUserModal.style.display = "none"; };
  document.getElementById("admin-edit-user-close")?.addEventListener("click", closeEditUserModal);
  document.getElementById("admin-edit-user-cancel")?.addEventListener("click", closeEditUserModal);
  editUserModal?.addEventListener("click", (e) => { if (e.target === editUserModal) closeEditUserModal(); });

  // Save the user profile (name, building, ban flag)
  const editUserForm = document.getElementById("admin-edit-user-form");
  if (editUserForm) {
    editUserForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const uid = document.getElementById("edit-user-uid").value;
      if (!uid) return;

      const payload = {
        name: document.getElementById("edit-user-name").value.trim() || "Unnamed",
        building: document.getElementById("edit-user-building").value.trim(),
        banned: document.getElementById("edit-user-banned").checked,
      };

      try {
        await updateDoc(doc(db, "users", uid), payload);
        alert("User profile updated.");
        closeEditUserModal();
        loadAdminUsers();
      } catch (err) {
        console.error("Failed to update user:", err);
        alert("Failed to update user. Check console or Firestore rules.");
      }
    });
  }

  // Delete a user's Firestore profile (does not remove their Firebase Auth
  // login — that requires the Admin SDK server-side — but wipes their
  // profile and admin rights).
  document.getElementById("admin-delete-user-btn")?.addEventListener("click", async () => {
    const uid = document.getElementById("edit-user-uid").value;
    if (!uid) return;
    const target = allUsersCache.find((u) => u.uid === uid);
    if (target && target.email === ADMIN_EMAIL) {
      alert("The permanent admin profile can't be deleted.");
      return;
    }
    if (!confirm("Delete this user's profile data? Their login will still exist, but their profile and admin rights (if any) will be wiped.")) return;

    try {
      await deleteDoc(doc(db, "users", uid));
      await deleteDoc(doc(db, "admins", uid)).catch(() => {});
      alert("User profile deleted.");
      closeEditUserModal();
      loadAdminUsers();
    } catch (err) {
      console.error("Failed to delete user:", err);
      alert("Failed to delete user profile. Check Firestore rules.");
    }
  });

  // Handle edit form submission
  const editForm = document.getElementById("admin-edit-form");
  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const itemId = document.getElementById("edit-item-id").value;
      const title = document.getElementById("edit-item-title").value;
      const building = document.getElementById("edit-item-building").value;
      const quantityTotal = Math.max(1, Math.round(parseFloat(document.getElementById("edit-item-quantity").value)));
      const newStatus = document.getElementById("edit-item-status").value;

      try {
        const existing = allListingsCache.find((i) => i.id === itemId);
        const oldStatus = existing ? (existing.status || "available") : "available";

        let payload = { title, building, quantityTotal, updatedAt: serverTimestamp() };

        if (newStatus === "available" && oldStatus === "claimed") {
          // Flipping Borrowed -> Available here behaves exactly like the
          // lender's own "Mark as Returned" control — quantity is restored.
          payload = { ...payload, ...buildUnclaimUpdate({ ...existing, quantityTotal }) };
        } else if (newStatus === "claimed" && oldStatus !== "claimed") {
          payload = { ...payload, ...buildForceClaimUpdate(existing || {}) };
        } else {
          payload.status = newStatus;
          // Keep quantityAvailable in bounds if the admin only changed the total.
          if (existing) {
            const oldAvailable = typeof existing.quantityAvailable === "number"
              ? existing.quantityAvailable
              : (oldStatus === "available" ? resolveQuantityTotal(existing) : 0);
            payload.quantityAvailable = Math.max(0, Math.min(oldAvailable, quantityTotal));
          }
        }

        await updateDoc(doc(db, "items", itemId), payload);
        alert("Listing updated successfully!");
        closeEditModal();
        loadAdminStatsAndListings();
      } catch (err) {
        console.error("Failed to update item:", err);
        alert("Failed to update listing. Check console or Firestore rules.");
      }
    });
  }
});

// Keeps the public leaderboard summary fresh. It rebuilds itself when you open
// the dashboard (if it's older than 5 minutes) and on demand with the button.
async function refreshLeaderboard(manual = false) {
  const status = document.getElementById("publish-lb-status");
  const btn = document.getElementById("publish-lb-btn");
  const say = (t) => { if (status) status.textContent = t; };
  if (btn) btn.disabled = true;
  try {
    if (!manual) {
      const last = await leaderboardUpdatedAt();
      if (last && Date.now() - last.getTime() < 5 * 60 * 1000) {
        say("Leaderboard updated " + last.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        return;
      }
    }
    say("Updating…");
    await publishLeaderboard();
    say("Leaderboard updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  } catch (e) {
    console.error("Leaderboard publish failed:", e);
    say("Couldn't update. Re-publish firestore.rules and try again.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function initAdminDashboard() {
  const btn = document.getElementById("publish-lb-btn");
  if (btn) btn.addEventListener("click", () => refreshLeaderboard(true));
  await loadAdminStatsAndListings();
  await loadAdminUsers();
  refreshLeaderboard(false); // after the page is usable, so it never slows the dashboard down
}

async function loadAdminStatsAndListings() {
  const statTotal = document.getElementById("stat-total-items");
  const statClaimed = document.getElementById("stat-claimed-items");

  try {
    const q = query(collection(db, "items"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    allListingsCache = [];
    let claimedCount = 0;

    snapshot.forEach((itemDoc) => {
      const data = itemDoc.data();
      allListingsCache.push({ id: itemDoc.id, ...data });
      if (data.status === "claimed") claimedCount++;
    });

    statTotal.textContent = allListingsCache.length;
    statClaimed.textContent = claimedCount;

    renderListingsTable(allListingsCache);
  } catch (err) {
    console.error("Error loading admin listings:", err);
    document.getElementById("admin-listings-body").innerHTML = `<tr><td colspan="5" style="text-align: center; color: red;">Failed to load listings.</td></tr>`;
  }
}

function filterListings(queryText) {
  const lower = queryText.toLowerCase().trim();
  if (!lower) return allListingsCache;
  return allListingsCache.filter(item => 
    (item.title && item.title.toLowerCase().includes(lower)) ||
    (item.building && item.building.toLowerCase().includes(lower))
  );
}

function renderListingsTable(itemsArray) {
  const tbody = document.getElementById("admin-listings-body");
  if (!tbody) return;

  if (itemsArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--admin-muted);">No matching listings found.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  itemsArray.forEach((item) => {
    const isClaimed = item.status === 'claimed';
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(item.title)}</strong></td>
      <td>${escapeHtml(item.building || 'General')}</td>
      <td>
        <span class="badge ${isClaimed ? 'badge-claimed' : 'badge-available'}">${isClaimed ? 'borrowed' : 'available'}</span>
        <button class="btn-action btn-outline-action toggle-status-btn" data-id="${escapeHtml(item.id)}" data-status="${isClaimed ? 'available' : 'claimed'}" style="margin-left: 8px; font-size: 0.75rem; padding: 2px 6px;">
          Mark ${isClaimed ? 'Returned' : 'Borrowed'}
        </button>
      </td>
      <td style="font-family: monospace; font-size: 0.8rem;">
        <button class="btn-action btn-outline-action view-owner-btn" data-uid="${escapeHtml(item.userId || '')}" style="${item.userId ? '' : 'display:none;'}">
          ${escapeHtml(item.userId || 'Unknown')}
        </button>
      </td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn-action btn-outline-action edit-item-btn" data-id="${escapeHtml(item.id)}">Edit</button>
          <button class="btn-action btn-danger-action delete-item-btn" data-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach quick status toggle handlers
  document.querySelectorAll(".toggle-status-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const itemId = e.target.getAttribute("data-id");
      const newStatus = e.target.getAttribute("data-status");
      const item = allListingsCache.find((i) => i.id === itemId);

      try {
        // Toggling Borrowed -> Available here fully restores quantity,
        // matching the lender's own "Mark as Returned" control.
        const payload = newStatus === "available"
          ? buildUnclaimUpdate(item || {})
          : buildForceClaimUpdate(item || {});
        await updateDoc(doc(db, "items", itemId), payload);
        loadAdminStatsAndListings();
      } catch (err) {
        console.error(err);
        alert("Failed to toggle item status. Check Firestore rules.");
      }
    });
  });

  // Attach Edit handlers to open modal
  document.querySelectorAll(".edit-item-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const itemId = e.target.getAttribute("data-id");
      const item = allListingsCache.find(i => i.id === itemId);
      if (!item) return;

      document.getElementById("edit-item-id").value = item.id;
      document.getElementById("edit-item-title").value = item.title || "";
      document.getElementById("edit-item-building").value = item.building || "";
      document.getElementById("edit-item-quantity").value = resolveQuantityTotal(item);
      document.getElementById("edit-item-status").value = item.status || "available";
      const note = document.getElementById("edit-item-status-note");
      if (note) {
        note.textContent = "Switching Borrowed → Available restores the full quantity (same as the lender's Mark as Returned).";
      }

      const modal = document.getElementById("admin-edit-modal");
      if (modal) modal.style.display = "flex";
    });
  });

  // Attach delete handlers
  document.querySelectorAll(".delete-item-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const itemId = e.target.getAttribute("data-id");
      if (confirm("Permanently delete this item listing?")) {
        try {
          await deleteDoc(doc(db, "items", itemId));
          deleteDoc(doc(db, "itemPhotos", itemId)).catch(() => {});
          alert("Listing removed.");
          loadAdminStatsAndListings();
        } catch (err) {
          alert("Deletion failed.");
        }
      }
    });
  });

  // Jump straight to a listing's owner in the Users tab
  document.querySelectorAll(".view-owner-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const uid = e.currentTarget.getAttribute("data-uid");
      if (!uid) return;
      document.querySelector('.tab-btn[data-tab="users-tab"]')?.click();
      if (allUsersCache.some((u) => u.uid === uid)) {
        openUserEditor(uid);
      } else {
        alert("This user's profile hasn't loaded yet — try the Users tab search.");
      }
    });
  });
}

async function loadAdminUsers() {
  const statUsers = document.getElementById("stat-total-users");

  try {
    // Fetch the whole `admins` collection once instead of one extra
    // getDoc() per user (that was N+1 reads for N users) and just look
    // up membership in the resulting set as we build the cache.
    const [usersSnapshot, adminsSnapshot, privSnapshot] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "admins")),
      getDocs(collection(db, "userPrivate")),
    ]);
    const emailByUid = new Map(privSnapshot.docs.map((d) => [d.id, d.data().email]));
    const adminUids = new Set(adminsSnapshot.docs.map((d) => d.id));

    allUsersCache = usersSnapshot.docs.map((userDoc) => {
      const uid = userDoc.id;
      return { uid, ...userDoc.data(), email: emailByUid.get(uid) || userDoc.data().email || "", isAdmin: adminUids.has(uid) };
    });

    statUsers.textContent = allUsersCache.length;
    renderUsersTable(allUsersCache);
  } catch (err) {
    console.error("Error loading users:", err);
    document.getElementById("admin-users-body").innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Failed to load users.</td></tr>`;
  }
}

function filterUsers(queryText) {
  const lower = queryText.toLowerCase().trim();
  if (!lower) return allUsersCache;
  return allUsersCache.filter(user => 
    (user.name && user.name.toLowerCase().includes(lower)) ||
    (user.email && user.email.toLowerCase().includes(lower)) ||
    (user.building && user.building.toLowerCase().includes(lower))
  );
}

function renderUsersTable(usersArray) {
  const tbody = document.getElementById("admin-users-body");
  if (!tbody) return;

  if (usersArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--admin-muted);">No matching users found.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  usersArray.forEach((user) => {
    const isPermanentAdmin = user.email === ADMIN_EMAIL;
    const activity = getUserActivity(user.uid);
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <button class="view-user-btn" data-uid="${escapeHtml(user.uid)}" style="background:none; border:none; padding:0; cursor:pointer; text-align:left; font-weight:700; color:#14703a; text-decoration:underline;">
          ${escapeHtml(user.name || 'Unnamed')}
        </button>
        ${user.banned ? `<div><span class="badge" style="background:#fee2e2; color:#991b1b; margin-top:4px;">🚫 Banned</span></div>` : ""}
      </td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.building || 'N/A')}</td>
      <td>
        ${activity.lent} lent / ${activity.borrowed} borrowed
      </td>
      <td>
        <select class="rank-select" data-uid="${escapeHtml(user.uid)}" title="Give this member a rank" style="padding:6px 8px;border:1px solid #d5e3da;border-radius:6px;font-size:0.82rem;background:#fff;color:#0e1a12;">
          <option value="">Auto (by points)</option>
          ${TIERS.map((t) => `<option value="${t.key}" ${user.rank === t.key ? "selected" : ""}>${t.icon} ${t.name}</option>`).join("")}
        </select>
      </td>
      <td><span class="badge ${user.isAdmin || isPermanentAdmin ? 'badge-admin' : 'badge-available'}">${user.isAdmin || isPermanentAdmin ? 'Admin' : 'Member'}</span></td>
      <td>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button class="btn-action btn-outline-action view-user-btn" data-uid="${escapeHtml(user.uid)}">Edit</button>
          ${
            isPermanentAdmin
              ? `<span style="color: #14632f; font-weight: 600; font-size: 0.75rem; background: #d3f5df; padding: 4px 8px; border-radius: 4px; display: inline-block;">🔒 Permanent Admin</span>`
              : (user.isAdmin
                  ? `<button class="btn-action btn-outline-action toggle-admin-btn" data-uid="${escapeHtml(user.uid)}" data-action="demote">Revoke Admin</button>`
                  : `<button class="btn-action btn-primary-action toggle-admin-btn" data-uid="${escapeHtml(user.uid)}" data-action="promote">Make Admin</button>`
                )
          }
          ${
            !isPermanentAdmin
              ? `<button class="btn-action ${user.banned ? 'btn-outline-action' : 'btn-danger-action'} toggle-ban-btn" data-uid="${escapeHtml(user.uid)}" data-action="${user.banned ? 'unban' : 'ban'}">${user.banned ? 'Unban' : 'Ban'}</button>`
              : ""
          }
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Give / change / clear a member's rank. "Auto" removes the manual rank
  // so the member goes back to their points-based tier.
  document.querySelectorAll(".rank-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const uid = e.currentTarget.getAttribute("data-uid");
      const key = e.currentTarget.value;
      const user = allUsersCache.find((u) => u.uid === uid);
      try {
        await updateDoc(doc(db, "users", uid), { rank: key || null });
        refreshLeaderboard(true);
        if (user) user.rank = key || null;
        const t = tierByKey(key);
        alert(t ? `${user ? user.name || "User" : "User"} is now ${t.icon} ${t.name}.` : "Rank reset to automatic (by points).");
      } catch (err) {
        console.error("Failed to set rank:", err);
        alert("Failed to set rank. Make sure the updated firestore.rules are published.");
        if (user) e.currentTarget.value = user.rank || "";
      }
    });
  });

  // Username / Edit buttons open the full profile editor
  document.querySelectorAll(".view-user-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const uid = e.currentTarget.getAttribute("data-uid");
      openUserEditor(uid);
    });
  });

  // Attach promote/demote handlers
  document.querySelectorAll(".toggle-admin-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const uid = e.target.getAttribute("data-uid");
      const action = e.target.getAttribute("data-action");

      const targetUser = allUsersCache.find(u => u.uid === uid);
      
      if (targetUser && targetUser.email === ADMIN_EMAIL && action === "demote") {
        alert("Action denied: Cannot remove the permanent administrator.");
        return;
      }

      try {
        if (action === "promote") {
          const email = targetUser ? targetUser.email : "unknown@user.com";
          await setDoc(doc(db, "admins", uid), { email, updatedAt: serverTimestamp() });
          alert("User promoted to Admin successfully!");
        } else {
          await deleteDoc(doc(db, "admins", uid));
          alert("Admin privileges revoked.");
        }
        loadAdminUsers();
      } catch (err) {
        alert("Failed to update admin status. Check permissions.");
        console.error(err);
      }
    });
  });

  // Quick ban / unban toggle directly from the table row
  document.querySelectorAll(".toggle-ban-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const uid = e.target.getAttribute("data-uid");
      const action = e.target.getAttribute("data-action");
      try {
        await updateDoc(doc(db, "users", uid), { banned: action === "ban" });
        try { await setDevicesBanned(uid, action === "ban"); } catch (e) { console.warn("Device ban failed:", e); }
        loadAdminUsers();
      } catch (err) {
        console.error(err);
        alert("Failed to update ban status. Check Firestore rules.");
      }
    });
  });
}

// --- User profile editor modal ---

// How many items a member has listed (lent) and how many borrows they've
// made, worked out from the listings already loaded for this dashboard.
function getUserActivity(uid) {
  let lent = 0;
  let borrowed = 0;
  allListingsCache.forEach((item) => {
    if (item.userId === uid) lent += 1;
    (item.claims || []).forEach((c) => { if (c && c.uid === uid) borrowed += 1; });
  });
  return { lent, borrowed };
}

async function openUserEditor(uid) {
  const user = allUsersCache.find((u) => u.uid === uid);
  if (!user) return;

  document.getElementById("edit-user-uid").value = uid;
  document.getElementById("edit-user-uid-label").textContent = uid;
  document.getElementById("edit-user-name").value = user.name || "";
  document.getElementById("edit-user-building").value = user.building || "";
  document.getElementById("edit-user-banned").checked = !!user.banned;
  await renderIpRow(user);

  const deleteBtn = document.getElementById("admin-delete-user-btn");
  if (deleteBtn) deleteBtn.style.display = user.email === ADMIN_EMAIL ? "none" : "inline-flex";

  const modal = document.getElementById("admin-edit-user-modal");
  if (modal) modal.style.display = "flex";
}

// Shows the user's last-known IP (recorded at their last login) with a
// one-click ban/unban toggle, so an admin can shut down ban-evasion via a
// second account on the same network — see js/ip-guard.js for the
// (best-effort, client-only) limitations of this approach.
async function renderIpRow(user) {
  const row = document.getElementById("edit-user-ip-row");
  const valueEl = document.getElementById("edit-user-ip-value");
  const toggleBtn = document.getElementById("edit-user-ip-toggle-btn");
  if (!row || !valueEl || !toggleBtn) return;

  let ip = user.lastKnownIp;
  try {
    const ipSnap = await getDoc(doc(db, "userIps", user.uid));
    if (ipSnap.exists()) ip = ipSnap.data().ip;
  } catch (e) { /* fall back to legacy field */ }
  if (!ip) {
    row.style.display = "none";
    return;
  }

  row.style.display = "flex";
  valueEl.textContent = ip;
  toggleBtn.disabled = true;
  toggleBtn.textContent = "Checking...";

  const banned = await isIpBanned(ip);
  toggleBtn.disabled = false;
  toggleBtn.textContent = banned ? "Unban this IP" : "Ban this IP";
  toggleBtn.className = `btn-action ${banned ? 'btn-outline-action' : 'btn-danger-action'}`;

  toggleBtn.onclick = async () => {
    toggleBtn.disabled = true;
    try {
      if (banned) {
        await unbanIp(ip);
      } else {
        await banIp(ip, `Banned via admin console from ${user.name || user.email}'s profile`, auth.currentUser ? auth.currentUser.uid : null);
      }
      await renderIpRow(user);
    } catch (err) {
      console.error("Failed to toggle IP ban:", err);
      alert("Failed to update IP ban status. Check Firestore rules.");
      toggleBtn.disabled = false;
    }
  };
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}