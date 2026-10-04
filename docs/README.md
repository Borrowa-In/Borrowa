# Borrowa

A community **share & borrow** site. Neighbors lend things they aren't using,
borrow what they need, and ask the community when they can't find something.
The most active members climb the leaderboard.

Plain HTML/CSS/JS, wired up to Firebase (Auth + Firestore). No
build tools, no npm — open it and go.

## 1. Open in VS Code
Unzip this folder, open it in VS Code, and install the **Live Server**
extension (Ritwick Dey) if you don't have it. Right-click `index.html` →
"Open with Live Server". `index.html` is the welcome/landing page with
Sign in / Sign up buttons, and you can click "Continue as guest" to look
around without an account.

## 2. Connect Firebase
1. Go to https://console.firebase.google.com → **Add project**.
2. Add a Web app and paste its config into `js/firebase-config.js`.
3. Enable **Authentication → Email/Password** (new members get a verification email; Firebase sends it, nothing to configure) and **Firestore Database**. (Storage is not used, so the free Spark plan is enough.)
4. Paste `config/firestore.rules` into Firestore → **Rules**.
   **Re-publish `config/firestore.rules` whenever it changes.** The current rules require a verified email, so publish them together with this version of the site.

## How it works
- **Lend an item** — list something with a photo, category, condition, quantity, pickup spot and how long you're happy to lend it for ("Borrow for up to…"). Listings stay up until you remove them.
- **Borrow an item** — tap *Borrow item*; a private chat opens with the lender to arrange pickup and return. When it's back, the lender taps **Mark as Returned**; that confirmation is what earns both people points, and the item is available again. Items with several units can be borrowed a few at a time.
- **Borrow requests** (`requests.html`) — ask the community for something you need. Neighbors tap *I can lend this*, which records an offer and opens a chat. Requesters can mark a request fulfilled (they pick which neighbor helped), reopen it, or delete it.
- **Leaderboard** (`leaderboard.html`) — ranks the **most active members**. Points are worked out live from the `items` and `borrowRequests` collections (nothing stored, nothing to edit). They are built to resist fake accounts, so only *confirmed* exchanges earn real points:

  | Action | Points | Limit |
  |---|---|---|
  | List an item to lend | +2 | first 5 listings |
  | Lend to a neighbor who returns it (lender confirms with **Mark as Returned**) | +8 | once per neighbor, max 20 |
  | Borrow from a neighbor and return it (lender confirmed) | +8 | once per neighbor, max 20 |
  | Be chosen as the helper on someone's request | +6 | once per neighbor, max 20 |
  | Your request gets fulfilled by a named helper | +3 | per fulfilled request, up to your counted requests |
  | Post a request | +1 | first 5 requests |

  Rules that stop farming: a loan must last at least 15 minutes, never counts on your own item, every *pair* of people scores once in total (either direction), and anything involving a banned account stops counting. A single account tops out at 470 points.

  **Rank tiers** (shown as custom cards, a podium and badges): Newcomer 0 · 🥉 Bronze 15 · 🥈 Silver 40 · 🥇 Gold 90 · 💠 Platinum 160 · 💎 Diamond 260. Item cards, the profile menu and the leaderboard take on the style of the member's tier.

  **Admins can award ranks:** Admin console → *Manage Users & Admins* → pick a tier in the **Rank** dropdown (or **Auto** to go back to points). Stored as `users/{uid}.rank`; only admins can write it (re-publish `config/firestore.rules`).

  Change the scoring in `public/js/points.js` (then run `npm run sync-points` inside `functions/` if you use Cloud Functions, and `node tests/points.test.mjs` to check it) and the tiers in `TIERS` at the top of `public/js/ranks.js`.
- **Messages** (`chat.html`) — private, end-to-end encrypted thread per item between the two people involved.

## Project structure
```
borrowa/
  public/                 The website (this folder is what gets deployed)
    *.html                index (landing), home (browse + lend), requests, leaderboard, login,
                          chat, admin, verify, report, contact, privacy, terms
    css/style.css         All styling
    js/                   firebase-config.js (keys + ADMIN_EMAIL), auth.js, device.js, device-full.js,
                          ip-guard.js, main.js, requests.js, chat.js, e2ee.js, points.js, ranks.js,
                          leaderboard.js, notifications.js, push.js (phone alerts), admin.js, ...
                          (one file per feature)
    sw.js, manifest.webmanifest, icons/   Service worker (shows pushes), install manifest, app icons
    404.html, robots.txt  Not-found page and crawler rules
  config/                 firestore.rules, firestore.dev.rules (emulator only, never deploy),
                          firestore.indexes.json
  docs/                   README.md, LAUNCH_CHECKLIST.md, WORK_IN_PROGRESS.md, DEV_TESTING.md
  functions/              Optional Cloud Functions backend (needs the Blaze plan)
  tests/                  points.test.mjs, push.test.mjs
  scripts/                make_dev_rules.py
  firebase.json, firebase.dev.json, .firebaserc, package.json
                          Tool config. The Firebase CLI expects these at the top level.
```

## Free "backend" (no card needed)
`leaderboard/top` is a single pre-computed document with the rankings and the
home-page numbers. **Opening `admin.html` rebuilds it** (if older than 5 minutes),
changing a member's rank rebuilds it, and the **Refresh leaderboard** button does
it on demand. Visitors read that one document instead of the whole database.
If it hasn't been refreshed for 3 hours, visitors' browsers ignore it and work the
numbers out themselves, so nobody ever sees badly stale data. **Re-publish
`config/firestore.rules`** once so admins are allowed to write it.

## Optional: Cloud Functions backend (needs the Blaze plan)
Not needed for the free setup above. To use it, deploy `functions/` and set
`USE_CLOUD_FUNCTIONS = true` in `js/firebase-config.js`.

The site already had a "backend as a service": Firebase Auth and Firestore
and the security rules. What it lacked was **server-side code**, so the browser
did all the heavy lifting. `functions/` adds that:

| Function | What it does |
|---|---|
| `onItemWrite`, `onRequestWrite`, `onUserWrite`, `sweepLeaderboard` | Keep one document, `leaderboard/top` (ranked members + home-page stats) up to date. Pages read that single doc instead of downloading every item, request and user. |
| `pushOnItem`, `pushOnRequest`, `pushOnOffer`, `pushOnNotification`, `pushOnChatMessage` | Send phone push notifications (see "Phone alerts" below). |
| `checkIp` | Returns the caller's real IP from the server (can't be faked) and whether it is in `bannedIPs`. Replaces the third-party ipify call. |

Everything **falls back automatically** if the functions aren't deployed (the
browser works the numbers out itself, like before), so the site works either way.

**Deploy** (Cloud Functions needs the Blaze pay-as-you-go plan; at student-site
traffic it normally stays inside the free allowance):
```
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules
```
The functions run on **Node 22** (`functions/package.json` and `firebase.json`). Node 20 is being retired by Google, so don't go back to it.
After deploying, edit any item once (or wait 10 minutes) to create `leaderboard/top`.
Optional: `firebase deploy --only hosting` serves the site from Firebase's CDN.

### Page-switch speed (what changed)
- Home no longer waits for GPS before showing items (location arrives later and just re-sorts).
- The IP-ban check is cached per session and runs in the background, not before every page.
- Rank/leaderboard/home-stat data is fetched once, shared, cached in `sessionStorage`, and painted instantly on the next page.
- The nav (profile, log out, Dashboard) is drawn from cache immediately (`js/nav-cache.js`).
- Pages cross-fade (View Transitions) with the nav held still, and links are prefetched on hover (`js/prefetch.js`).

## Phone alerts (push notifications)
Members can get a notification on their phone when a neighbour posts an item or a request, when
someone offers to help with their request, when their item is borrowed, for due/expiry reminders,
and for new chat messages, even when Borrowa is closed.

How it works: `public/js/push.js` asks permission (only after a tap), gets an FCM token and saves it in
`pushTokens/{token}`. The Cloud Functions in `functions/index.js` (`pushOn...`) read those tokens and send
**data-only** messages; `public/sw.js` shows them and opens the right page when tapped.
- Chat is end-to-end encrypted, so a chat alert only says "New message from NAME", never the text.
- Listing and request alerts are limited to one per member per 5 minutes (`pushThrottle`), so nobody can spam everyone.
- Turning alerts off, or logging out, removes that phone's token. Dead tokens are cleaned up automatically.
- Everything stays hidden until `VAPID_PUBLIC_KEY` is set in `js/firebase-config.js`.
- Needs the **Blaze plan** (Cloud Functions). iPhone: only after "Add to Home Screen" (iOS 16.4+). Android Chrome works in the browser.
- Pure helpers are in `functions/push.js` and tested by `tests/push.test.mjs`.

## Admin console
The **Borrow Requests** tab shows active requests first (with a count and an Active / Fulfilled / All filter), and the dashboard has an **Active Requests** card. Guests can browse but can't lend: their "Lend" buttons send them to log in or sign up.
There is one login page for everyone (`login.html`). Signing in with the
email in `ADMIN_EMAIL` (`js/firebase-config.js`) sends you to `admin.html`;
everyone else goes to `home.html`. The admin lock is enforced in
`config/firestore.rules` too, not just in the UI. Keep `ADMIN_EMAIL` and the email in
`isPermanentAdminEmail()` inside `config/firestore.rules` the same.

From the console an admin can:
- **Listings** — edit, delete, or flip any item between *Borrowed* and *Available*.
- **Users & Admins** — see each member's lent/borrowed counts; edit name/building; ban/unban (blocks lending, borrowing, requests and chat — enforced by `config/firestore.rules`); ban/unban their IP; promote/revoke admin; delete a profile (their login itself stays, since deleting Auth accounts needs the Admin SDK).
- **Borrow Requests** — mark fulfilled/reopen or delete any request.

`admin-dashboard.html` (an older console) is now just a plain redirect to `admin.html`.

### IP banning (best-effort)
This is a static frontend + Firestore app with no backend server, and
Firestore Security Rules have no way to see a request's real network IP —
there's no `request.ip` in the rules language. So IP banning here is a
**deterrent, not a guarantee**: the client asks a public "what's my IP"
service (ipify) for its own address, records it on the user's profile at
every login (`users/{uid}.lastKnownIp`), and checks it against an
admin-maintained `bannedIPs` collection at login/signup and on every page
load. An admin bans an IP from the same "Edit User" panel described above.
It stops the casual case (banning someone, then them just signing up again
from the same home wifi) but a VPN or a different network gets around it.

## Data model
- **users/{uid}**: `name, email, building, banned?, rank?`
- **userIps/{uid}**: `ip, updatedAt` (private: only the member and admins can read it)
- **items/{id}**: `title, category, condition, quantityTotal, quantityAvailable, quantityUnit, pickupLocation, borrowPeriod, description, photoURL, status ("available" | "claimed" = borrowed), userId, userEmail, claimedBy?, claimedByName?, claims[] (one entry per borrow: uid, name, amount, claimedAt), completedBy[] (lender-confirmed returns: uid, at), location?`
- **borrowRequests/{id}**: `userId, userName, title, category, details, duration, neededBy, building, status ("open" | "fulfilled"), offerCount, offeredBy[], fulfilledBy?`
- **chats/{id}** (+ `messages` subcollection), **notifications/{id}**, **admins/{uid}**, **bannedIPs/{ip}**

Some field names (`status: "claimed"`, `claimedBy`, `claims`) still use the older
"claim" wording; the site shows them as "Borrowed". Renaming them would break
existing data, so they were left alone.

## How the sign-in flow works
`index.html` is the entry point; its buttons go to `login.html?mode=...`.
After sign up or log in, the admin account goes to `admin.html` and everyone
else to `home.html` (or wherever `?next=` pointed). `home.html`,
`requests.html`, `leaderboard.html` and `chat.html` call `guardPage()` from
`js/auth.js` — if nobody is signed in (and they haven't clicked "Continue as
guest") they're bounced back to `index.html`. Guest mode lives in
`sessionStorage` and is cleared on logout.

## Things That will be added:-
 #fix the item posting table by keeping different time limits for food and other items and keeping the food limit for 2 hrs and other items max limit for posting for 5days and they get removed #Identity verification using an ai 
 #Also phonemumber and email id verification
 #Item verification using ai if it's real or not 
 #No of of posing according to number of items like if there are 2 items there will be 2 posting so 2 different people can get it 
 #A highly secure system so noone can bypass it to fool people or get personal data
 #lag free website and market it around colleges and unis as there will be the most students
 #make it completely free but adding ads at the sides so the cost of hosting and all come into account 
 #forget password option through OTP by email or phone number 
 #Admin should have the access to change the item from claimed to unclaimed,admin must have the access to ban a id,ip. Admin also must have the access to unban id and ip 
 #a report system which automatically bans certain person from posting and recieving items and the banned person gets a option to appeal to a admin to get unban by proving they weren't misusing

## Borrow requests
`requests.html` is a board where members ask for items they need.
- **Request an item** — title, category, how long, needed-by date, building, optional details (max 5 open requests per member).
- **I can lend this** — records an offer on the request and opens a Messages thread with the requester.
- Requesters can **Mark fulfilled**, **Reopen**, or **Delete**. Admins can moderate every request from the *Borrow Requests* tab in `admin.html`.
- Data lives in the `borrowRequests` Firestore collection.


## Security notes
- **Publish `config/firestore.rules`** after every change. The site relies on them: the browser code can be edited by anyone, the rules cannot.
- **Rules enforce, not the UI:** members can only edit their own listings (never `claims`, `userId`, `createdAt`), a borrower can only take units off a listing and add one claim in their own name for the exact amount taken, only admins can set `role`, `banned` or `rank`, chats can't change participants, and every text field has a length limit. Photos must be Firebase Storage URLs; uploads must be JPEG/PNG/WebP/GIF.
- **XSS:** every user-supplied value is HTML-escaped before it goes into a template; photo URLs are checked against a Firebase Storage pattern; `?next=` on the login page only accepts local `.html` pages; each page has a Content-Security-Policy that blocks scripts from other sites and plugins. If you add a new third-party script/API, add its host to the CSP `<meta>` in the page head.
- **Verified email required:** lending, borrowing, requesting and offering need a verified email, and `+` aliases (me+2@gmail.com) are refused, so one inbox can't become many accounts. Browsing and chat still work while unverified. The admin account is exempt. Enforced in `config/firestore.rules` (`isVerified()`).
- **Points can't be edited:** they are recomputed from Firestore data (not stored). Borrow points need the lender's return confirmation (`completedBy`, append-only in the rules), each pair of people scores once, every category is capped, and a fulfilled request only credits a helper the requester picked from the people who actually offered (`fulfilledBy`).
- **Existing members:** accounts made before this update must click the link in the verification email (banner → *Resend email*) before they can lend or borrow again.
- **Permanent admin email:** `shouryaupadhyay50@gmail.com` is trusted by email address. Make sure that account is already registered by you so nobody else can sign up with it first.
