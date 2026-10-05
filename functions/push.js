// Pure helpers for phone push notifications. No Firebase imports here so they can be
// unit tested with plain Node (see ../tests/push.test.mjs).

const MAX_PER_SEND = 500; // FCM allows at most 500 tokens per multicast call

// Error codes that mean "this token will never work again": delete it.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

function chunk(list, size = MAX_PER_SEND) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Plain one-line text: no control characters, collapsed spaces, capped length.
function clean(value, max) {
  const t = String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "\u2026" : t;
}

// Only ever relative page URLs on our own site (the site may live under a sub-path).
function safeUrl(url, fallback = "home.html") {
  const u = String(url == null ? "" : url).trim();
  if (!u || /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//") || u.startsWith("/") || u.includes("\\")) return fallback;
  return u;
}

// FCM data payloads must be flat objects of strings. sw.js reads title/body/url/tag/kind.
function buildMessage({ kind, title, body, url, tag }) {
  return {
    data: {
      kind: clean(kind, 30),
      title: clean(title, 60) || "Borrowa",
      body: clean(body, 140),
      url: safeUrl(url),
      tag: clean(tag, 80),
    },
  };
}

// One entry per distinct token, optionally skipping one member (the person who caused it).
// `docs` are plain { token, uid } objects.
function pickTokens(docs, { excludeUid = null } = {}) {
  const seen = new Set();
  const out = [];
  for (const d of docs || []) {
    const token = d && typeof d.token === "string" ? d.token : "";
    if (!token || seen.has(token)) continue;
    if (excludeUid && d.uid === excludeUid) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

// Which tokens in one multicast response failed permanently?
function deadTokens(tokens, responses) {
  const dead = [];
  (responses || []).forEach((r, i) => {
    if (r && !r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) dead.push(tokens[i]);
  });
  return dead;
}

// ---- message texts ----
function itemMessage(item, id) {
  const where = clean(item.pickupLocation, 40);
  return buildMessage({
    kind: "item", tag: `item-${id}`, url: "home.html",
    title: "New item to borrow",
    body: where ? `${clean(item.title, 60)} \u00b7 ${where}` : clean(item.title, 80),
  });
}

function requestMessage(req, id) {
  const where = clean(req.building, 40);
  return buildMessage({
    kind: "request", tag: `request-${id}`, url: "requests.html",
    title: "A neighbour needs something",
    body: where ? `${clean(req.title, 60)} \u00b7 ${where}` : clean(req.title, 80),
  });
}

function offerMessage(req, id) {
  return buildMessage({
    kind: "offer", tag: `offer-${id}`, url: "requests.html",
    title: "Someone can lend you something",
    body: `A neighbour offered to help with \u201c${clean(req.title, 60)}\u201d.`,
  });
}

// In-app notification documents (borrowed, due reminder, expiry).
function notificationMessage(n, id) {
  const title = clean(n.itemTitle, 60) || "your item";
  if (n.type === "due_reminder") {
    return buildMessage({ kind: "due", tag: `n-${id}`, url: "home.html",
      title: "Return reminder", body: `Please return ${title} by ${clean(n.dueLabel, 30) || "the due date"}.` });
  }
  if (n.type === "overdue_reminder") {
    return buildMessage({ kind: "due", tag: `n-${id}`, url: "home.html",
      title: "Overdue: please return", body: `${title} was due ${clean(n.dueLabel, 30) || "already"}. Please return it or message the lender.` });
  }
  if (n.type === "overdue_lender") {
    return buildMessage({ kind: "due", tag: `n-${id}`, url: "home.html",
      title: "Item is overdue", body: `${title} was due ${clean(n.dueLabel, 30) || "already"} and hasn't been returned.` });
  }
  if (n.type === "listing_expired") {
    return buildMessage({ kind: "expired", tag: `n-${id}`, url: "home.html",
      title: "Listing expired", body: `${title} was taken down because it expired.` });
  }
  return buildMessage({ kind: "borrowed", tag: `n-${id}`, url: "home.html",
    title: "Your item was borrowed",
    body: `${clean(n.claimedByName, 40) || "A neighbour"} borrowed ${title}.` });
}

// Chats are end-to-end encrypted, so the server only ever knows WHO wrote, never WHAT.
function chatMessage(senderName, chatId) {
  return buildMessage({
    kind: "chat", tag: `chat-${chatId}`, url: `chat.html?id=${encodeURIComponent(chatId)}`,
    title: "New message", body: `New message from ${clean(senderName, 40) || "a neighbour"}`,
  });
}

module.exports = {
  MAX_PER_SEND, DEAD_TOKEN_CODES, chunk, clean, safeUrl, buildMessage, pickTokens, deadTokens,
  itemMessage, requestMessage, offerMessage, notificationMessage, chatMessage,
};
