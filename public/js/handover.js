// Handover + return confirmation (firestore.rules: handovers/{itemId_borrowerUid}).
// The lender taps "Handed over", the borrower taps "I received it" and later "I returned it".
// Each person stamps only their own step, with the server time, so nobody can back-date it.
import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const handoverId = (itemId, borrowerUid) => `${itemId}_${borrowerUid}`;

export async function loadHandover(itemId, borrowerUid) {
  try {
    const s = await getDoc(doc(db, "handovers", handoverId(itemId, borrowerUid)));
    return s.exists() ? s.data() : null;
  } catch (e) { return null; }
}

// step: "lenderHandedAt" | "borrowerReceivedAt" | "borrowerReturnedAt"
export async function confirmStep({ itemId, itemTitle, lenderId, borrowerId, step, note = "" }) {
  const ref = doc(db, "handovers", handoverId(itemId, borrowerId));
  const cleanNote = String(note || "").slice(0, 200);
  const existing = await getDoc(ref).catch(() => null);
  if (existing && existing.exists()) {
    const patch = { [step]: serverTimestamp(), updatedAt: serverTimestamp() };
    if (cleanNote) patch.note = cleanNote;
    return updateDoc(ref, patch);
  }
  if (step === "borrowerReturnedAt") throw new Error("Confirm you received the item first.");
  const data = { itemId, itemTitle: String(itemTitle || "").slice(0, 200), lenderId, borrowerId, [step]: serverTimestamp(), updatedAt: serverTimestamp() };
  if (cleanNote) data.note = cleanNote;
  return setDoc(ref, data);
}

// The lender closes the loan: the record is no longer needed. Best effort, never blocks the return.
export async function closeHandover(itemId, borrowerUid) {
  try { await deleteDoc(doc(db, "handovers", handoverId(itemId, borrowerUid))); } catch (e) { /* ignore */ }
}

const fmt = (t) => { try { return t.toDate().toLocaleDateString(undefined, { day: "numeric", month: "short" }); } catch (e) { return ""; } };

// One short status line, e.g. "Handed over 5 Oct · Received 5 Oct · Returned (waiting for lender)".
export function handoverStatusText(h) {
  if (!h) return "No handover confirmed yet";
  const parts = [];
  parts.push(h.lenderHandedAt ? `Handed over ${fmt(h.lenderHandedAt)}` : "Lender hasn't confirmed handover");
  parts.push(h.borrowerReceivedAt ? `Received ${fmt(h.borrowerReceivedAt)}` : "Borrower hasn't confirmed receipt");
  if (h.borrowerReturnedAt) parts.push(`Borrower says returned ${fmt(h.borrowerReturnedAt)}`);
  return parts.join(" · ");
}
