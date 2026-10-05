// "Dispute" button in the borrow flow (firestore.rules: reports kind "loan"). Only the lender or the
// current borrower of the listing can file one. It goes to admins only (moderators never see loan
// disputes) and admins also see the handover record as evidence.
import { auth, db } from "./firebase-config.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const DISPUTE_REASONS = ["Item damaged", "Item not returned", "Item not as described", "Other problem with this loan"];

export async function fileDispute(itemId, reason, details) {
  const me = auth.currentUser;
  if (!me) throw new Error("Please log in.");
  return setDoc(doc(db, "reports", `loan_${itemId}_${me.uid}`), {
    kind: "loan", targetId: itemId, reason: String(reason).slice(0, 60), details: String(details || "").slice(0, 500),
    reporterId: me.uid, status: "open", createdAt: serverTimestamp(),
  });
}

export async function askAndDispute(itemId) {
  const pick = prompt("What went wrong?\n" + DISPUTE_REASONS.map((r, i) => `${i + 1} = ${r}`).join("\n") + "\n\nType 1-4:", "1");
  if (pick === null) return false;
  const reason = DISPUTE_REASONS[(parseInt(pick, 10) || 1) - 1] || DISPUTE_REASONS[3];
  const details = prompt("Add a short description for the moderators (optional).", "");
  if (details === null) return false;
  await fileDispute(itemId, reason, details);
  return true;
}
