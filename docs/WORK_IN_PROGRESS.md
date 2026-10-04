# Anti-cheat points system: finished

DONE
- js/points.js scoring (confirmed returns only, once per pair, caps, banned accounts excluded), 15 tests: `node tests/points.test.mjs`
- Email verification: link sent at signup, banner with Resend / "I've verified" (js/verify-banner.js on home, requests, chat, leaderboard), "+" aliases refused, friendly messages when lending/borrowing/requesting/offering unverified
- requests.js: "Mark fulfilled" asks who helped and saves fulfilledBy; Reopen clears it
- Leaderboard text, README, tiers (Bronze 15 / Silver 40 / Gold 90 / Platinum 160 / Diamond 260)
- functions/points.js generated from js/points.js (`npm run sync-points`); functions/index.js uses it

BEFORE GOING LIVE
1. Publish firestore.rules and deploy the site together.
2. Existing members must verify their email once (banner has a Resend button).
3. If you use Cloud Functions: `cd functions && npm install && npm run sync-points`, then deploy.
4. Admin console: click "Refresh leaderboard" so the stored board uses the new scoring.

STILL ON THE ROADMAP (README "Things That will be added")
- Phone verification / OTP, AI identity + item checks, food/other listing expiry, per-unit postings, reports + appeals, ads.

# Mobile menu, admin posts, item names (latest)

DONE
- js/mobile-nav.js + the "Mobile app layout" block at the end of css/style.css: on phones (<= 768px) the top bar is just a hamburger + logo; every nav item (pages, Dashboard for admins, profile + rank, Lend item, Sign in / Log out) lives in a slide-out menu on the left. Desktop is unchanged. Home hero, chat and pop-up forms no longer spill off the right edge.
- Admin posts: show an "ADMIN" rank instead of a points tier, and admins can pick their own card / border / title / text colours in the Lend form. firestore.rules only accept `adminPost` / `postStyle` from admins (firestore.dev.rules was regenerated too).
- Item names always start with a capital letter (saved that way and also fixed on display for old posts) and use the bold `.item-title` style.

BEFORE GOING LIVE
- Publish config/firestore.rules again (new admin-only fields).
- admin.html (the admin console) keeps its own top bar and was not changed.

# Bug sweep
- Search box on Browse now filters as you type and also matches pickup location and category (the placeholder promised "title or location" but only title/description were checked, and only Enter triggered it).
- Checked: every JS file parses, unit tests pass, no broken links/imports, all 13 pages load with no console errors and no sideways scroll on phone or desktop, admin posting saves a capitalised title + Admin flag + colours.
