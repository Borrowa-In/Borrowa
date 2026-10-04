// Shared item-status helpers.
//
// Both the lender's own listing controls (main.js) and the admin dashboard
// (admin.js) need to flip an item from "borrowed" back to "available" in
// exactly the same way, so that logic lives here once.
//
// Note: for historical reasons the Firestore fields still use the old
// "claim" names (status: "claimed", claimedBy, claims[]). In the UI a
// "claimed" item is shown as "Borrowed".

// Resolve an item's total quantity whether it uses the newer integer
// quantityTotal field or the legacy free-text "3 kg" string.
export function resolveQuantityTotal(item) {
  if (typeof item.quantityTotal === "number") {
    return Math.max(1, Math.round(item.quantityTotal));
  }
  const match = /^([\d.]+)\s*(.*)$/.exec((item.quantity || "").trim());
  return match ? Math.max(1, Math.round(parseFloat(match[1]))) : 1;
}

// Update payload for "Mark as returned": every unit becomes available
// again and the listing re-opens for the next borrower.
export function buildUnclaimUpdate(item) {
  const quantityTotal = resolveQuantityTotal(item);
  return {
    status: "available",
    quantityTotal,
    quantityAvailable: quantityTotal,
    quantityUnit: item.quantityUnit || "units",
    claimedBy: null,
    claimedByName: null,
    claimedAt: null,
  };
}

// Update payload for an admin force-closing a listing (marking it borrowed
// without an actual borrower) — zero out availability.
export function buildForceClaimUpdate(item) {
  return {
    status: "claimed",
    quantityAvailable: 0,
  };
}

// Update payload for the LENDER tapping "Mark as returned". It re-opens the
// listing like buildUnclaimUpdate, and it also records that each borrower
// handed the item back (items.completedBy = [{ uid, at }]). That confirmation
// is what turns a borrow into leaderboard points for both people. See
// js/points.js for the rules (minimum loan time, once per pair, etc).
export function buildReturnUpdate(item, now = new Date()) {
  const already = new Set((item.completedBy || []).map((d) => d && d.uid));
  const borrowers = [];
  (item.claims || []).forEach((c) => {
    if (c && c.uid && c.uid !== item.userId && !already.has(c.uid) && !borrowers.includes(c.uid)) borrowers.push(c.uid);
  });
  const update = buildUnclaimUpdate(item);
  if (borrowers.length) {
    update.completedBy = [...(item.completedBy || []), ...borrowers.slice(0, 25).map((uid) => ({ uid, at: now }))];
  }
  return update;
}
