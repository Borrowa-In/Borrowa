# Testing with lots of accounts (no limits)

```
npm i -g firebase-tools     # once (needs Java 11+ for the emulators)
npm run dev
```
Open **http://localhost:5000** (or http://127.0.0.1:5000). Any page opened from localhost/127.0.0.1 is in DEV MODE.

In dev mode the site uses a **local fake database** (Auth and Firestore emulators). Your real users and data are never touched, and everything resets when you stop the emulator.
Limits that are off: 2 accounts per device, duplicate/dotted Gmail check, IP-ban gate, "+" aliases (`me+1@gmail.com`, `me+2@gmail.com`…), email verification, 3 posts per 24h for new accounts.

Tips: use a new incognito window per account or just log out/in; the Emulator UI is at http://localhost:4000 (see/edit users, data).
To make an admin, sign up with the ADMIN_EMAIL from public/js/firebase-config.js.
Points scoring caps (once per pair, confirmed returns only) are intentionally unchanged, they're game logic, not account limits.

The deployed site is unaffected: DEV MODE can't switch on from your real domain, and `config/firestore.rules` is untouched. Never deploy `config/firestore.dev.rules`. After editing `config/firestore.rules`, run `npm run sync-dev-rules`.

---

# Unlimited admin device (works on the LIVE site, nothing to install)

Sign in once with the admin account (the `ADMIN_EMAIL` in `public/js/firebase-config.js`) in a browser.
That browser is then flagged as the **unlimited device**. Any account created or used in that same browser has:
no 2-accounts-per-device cap, no email verification, "+"/dotted emails allowed, no IP-ban gate, no 3-posts-per-24h cap.

To use it: log in as admin once, log out, then sign up as many test accounts as you want in that browser (log out between accounts).
A different browser, or an incognito window, is a different device, so log in as admin there once first.

Needs `config/firestore.rules` re-published (Firebase console -> Firestore Database -> Rules -> paste -> Publish) and the site files re-uploaded.
Security note: the flag can only be set by an admin, and the device ID is a private random value stored in the admin's browser. Don't share that browser profile.
You can switch it off any time by deleting the device's document in Firestore (devices collection) or removing the `testers` docs.

---

# 3rd account on a full device

A device still holds at most 2 accounts. When a 3rd account tries to log in or sign up there, a dialog lists the 2 accounts on the device (public/js/device-full.js; set `SHOW_FULL_EMAILS = false` to hide the middle of each address).
To continue, the person picks one, types that account's password and deletes it permanently (its device slot, listings, profile and sign-in). The original login/sign-up then continues automatically.
Accounts created before this update don't have an email stored on the device yet; they show as "Older account" and the person types the email. Each account fills in its email the next time it logs in on that device.
Needs `config/firestore.rules` re-published (Firebase console -> Firestore Database -> Rules -> Publish) and the site files re-uploaded. The admin's unlimited device is not affected.
