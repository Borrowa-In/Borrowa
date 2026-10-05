// Append-only record of sensitive admin actions (firestore.rules: adminLog). Never blocks the action itself.
import { auth, db } from "./firebase-config.js";
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function logAdminAction(action, target = "") {
  const u = auth.currentUser;
  if (!u) return;
  addDoc(collection(db, "adminLog"), {
    adminId: u.uid, adminEmail: String(u.email || "").slice(0, 120), action: String(action).slice(0, 80),
    target: String(target).slice(0, 200), createdAt: serverTimestamp(),
  }).catch((e) => console.warn("Couldn't write admin log:", e));
}

export async function loadAdminLog(max = 100) {
  const snap = await getDocs(query(collection(db, "adminLog"), orderBy("createdAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
