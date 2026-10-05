# Borrowa handoff (work in progress)

Stack: static site in `public/` (vanilla JS modules, Firebase v10.12.2 from gstatic), Firestore rules in `config/`, Cloud Functions in `functions/` (Node, firebase-functions v2), hosted on GitHub Pages (project sub-path, so use RELATIVE URLs only) or Firebase Hosting.

## DONE (and verified)
- Mobile left-edge bug fixed in `public/css/style.css`. Cause: rules like `.hero{padding:56px 0 40px}` sat on elements that also have `.container`, wiping the side gutter. Changed `.hero`, `.page-header`, `.preview-section`, `.feature-section`, `.steps-section` (and the mobile `.hero`) to padding-top/padding-bottom. Checked with Playwright at 360px: no text within 10px of the left edge on any page, no sideways scroll.
- Icons generated in `public/icons/` (icon-192/512, maskable-512, apple-touch-icon, favicon-32, badge-96).
- `public/manifest.webmanifest` written (relative paths).
- `public/sw.js` written: shows pushes (reads FCM `data` payload: title, body, url, tag, kind), opens `url` on tap, caches nothing.
- `public/js/push.js` written: permission, FCM token -> Firestore `pushTokens/{token}` {uid, token, broadcast, platform, updatedAt}, iOS "Add to Home Screen" handling, `renderPushControls()`, `mountPushPrompt()`, `refreshPushToken()`, `forgetPushOnThisDevice()`. NOT yet tested in a browser.
- `public/js/firebase-config.js`: now exports `app` and `VAPID_PUBLIC_KEY` (empty; user must paste key, everything stays hidden until then).

## DONE (items 1-10, code complete, see "Cannot be tested here")
1. push.js wired in: bell panel shows `renderPushControls()` (panel is `position:fixed; width:min(340px, calc(100vw - 24px))`), `main.js` calls `mountPushPrompt()` after listings render and `refreshPushToken(user)` on auth, `forgetPushOnThisDevice()` runs before both `signOut` calls in main.js and in `auth.js` `logOut()`; the bell refreshes on the service-worker `borrowa-push` message.
2. Push CSS appended to `css/style.css` (checked 320-390px).
3. manifest, theme-color, icons, description, og tags in every page; `noindex` on admin, verify, login.
4. `functions/index.js`: `pushOnItem`, `pushOnRequest`, `pushOnOffer`, `pushOnNotification`, `pushOnChatMessage` (data-only, chunks of 500, dead tokens deleted, 5-minute broadcast throttle). Helpers in `functions/push.js`, tests in `tests/push.test.mjs`.
5. `pushTokens` rules added to `config/firestore.rules`; dev rules regenerated.
6. Node 22 in `functions/package.json` and `firebase.json` (`runtime: nodejs22`).
7. Landing page shows real numbers from `leaderboard/top` (hidden if unavailable); sample listings labelled "Example".
8. `404.html`, `robots.txt`, security + cache headers in `firebase.json` (Firebase Hosting only).
9. Docs updated (README, LAUNCH_CHECKLIST).
10. Tests: `npm test`; Playwright screenshots at 320/360/390/768/1280.
Also done this session:
- Admin: "Active Requests" stat card, tab count, Active / Fulfilled / All filter (`admin.html`, `js/admin-requests.js`).
- Guests can no longer open the Lend form: nav/hero buttons read "Log in / Sign up" / "Sign up to lend" and go to login; `openModal()` and the submit handler also refuse without a signed-in user (`js/main.js`).
- Mobile menu (`js/mobile-nav.js`) now labels the bell "Notifications (n)" so phone users can reach the push switch.
- admin.html small-phone layout (<=560px): compact top bar, 2-column stat cards. Page never scrolls sideways at 320-1280.

## Verification results
- `npm test`: 15 points tests + 11 push tests pass. `node --check` passes on every JS file; all JSON valid.
- Playwright (Firebase modules stubbed, fake signed-in user, fake push-capable browser) at 320/360/390/768/1280 on index, home, requests, admin, guest home: no sideways scroll, text never closer than 16px to the left edge on phones, no console errors. Push prompt card, bell panel (fits inside viewport) and enable flow checked at 320/360/390.
- Admin minLeft shows negative in the tab strip because that strip scrolls inside its own container; the page itself does not overflow.

## Added in the final pass
- `tests/push-functions.test.cjs`: loads `functions/index.js` with stubbed Firebase modules and runs all 5 `pushOn...` handlers (poster excluded, dead tokens deleted, 5-min throttle, chat push has no message text, offer only on offerCount increase).
- `tests/sw.test.cjs`: runs `public/sw.js` in a fake worker scope on a sub-path (push shown, off-site URL rewritten to home, plain-text payload, tap opens right page).
- Cross-checked field names between client, rules and functions (userId, participants, senderId, offerCount, recipientId, `chat.html?id=`): all match. `functions/points.js` is in sync with `public/js/points.js`.
- `npm test` now runs all four suites.

## Gradient post styles + custom ranks (main admin)
- Admin post style: the Lend form's colour boxes are replaced by an INLINE colour studio (`js/color-studio.js`: quick gradients, swatches, hue/strength/light sliders, hex box, gradient angle). No browser colour pop-up anywhere. Post colours can now be a gradient: `postStyle` gained `bg2` and `angle` (rules: `validPostStyle`).
- Ranks tab in `admin.html` (`js/admin-ranks.js`, main admin only): give any built-in rank (and the Admin badge) a gradient, or create custom ranks (name, icon, colours, optional points needed). Stored in ONE doc `siteConfig/ranks` (read by all, written only by the permanent admin; rules in `firestore.rules`). `js/ranks.js` applies it in place to `TIERS` (cached 5 min per tab); `js/rank-style.js` holds the pure, tested colour/sanitising helpers.
- A custom rank with no points is only given by admins via the existing Rank drop-down in "Manage Users & Admins" (`users.rank = "c_xxxxxx"`; `points.js` accepts that id pattern; `functions/points.js` kept in sync). Deleting a custom rank sends its holders back to their points rank.
- MUST republish `config/firestore.rules` (new `siteConfig` block + gradient fields) or saving ranks / gradient posts is refused. `config/firestore.dev.rules` regenerated.
- Tests: `tests/rank-style.test.mjs` (+1 case in `tests/points.test.mjs`). Playwright (Firebase stubbed) checked the studio, the Ranks tab create/validate/save/delete/reset flow, gradient admin card, custom + restyled badges, at 390 and 1300 px. NOT checked against real Firestore rules.
- Also: `device.js` "Couldn't register this device" now shows the Firebase error code (e.g. permission-denied = rules not published).

## Visual redesign (matches the mockup; no logic changed)
- White top bar with round logo, centred links, green pill buttons; warm peach hero; dark stat cards with green numbers; rounded item cards; "How Borrowa Works" + Lend/Borrow panel. Styles are the last block of `css/style.css` ("Borrowa light redesign").
- No photos: hero people, step icons and item pictures are inline SVG (`public/js/art.js` picks a picture from the item title/category). `main.js` only gained one import and one template line (`${itemArtHtml(item)}`).
- All ids, forms and scripts kept (hero-post-btn, stat-* ids, search-input, filter chips, item-grid, modals). "List your item to lend" uses the existing `home.html?lend=1` flow.
- Checked with Playwright (Firebase stubbed) at 360/390/1280: no sideways scroll, no console errors on home, index, requests, leaderboard, login, contact.

## FREE push route (owner has no card; use this instead of Blaze)
- `scripts/push-poller.mjs` + `.github/workflows/push.yml` + `docs/FREE_PUSH.md`: GitHub Actions job every ~5 min reads Firestore with a service account and sends FCM. Reuses `functions/push.js`. Tested by `tests/push-poller.test.mjs`. Do NOT also deploy the `pushOn...` functions (double alerts).
- Needs secret `FIREBASE_SERVICE_ACCOUNT` + VAPID key + published rules.

## NOT verified (needs real services)
- Real push delivery, FCM token creation, VAPID key, Blaze deploy of the 5 `pushOn...` functions.
- Firestore rules in the emulator (the new `pushTokens` block and the earlier changes were only read, not executed).
- Security headers (Firebase Hosting only; GitHub Pages ignores `firebase.json`).
- Landing-page live stats need `leaderboard/top` to exist (Cloud Functions or admin "Refresh leaderboard").

## Next steps for the owner
See `docs/LAUNCH_CHECKLIST.md` -> "Phone push notifications (only you can do these)".

## Cannot be tested here
Real push delivery (needs the Firebase project, Blaze, VAPID key, real phones) and Firestore rules in the emulator.

## Honest limits to tell the user
- Pushing to a closed phone needs a server: Cloud Functions, so Firebase Blaze plan (card required; cost ~0 at this scale).
- iPhone: only works after "Add to Home Screen" (iOS 16.4+). Android Chrome works in the browser.
- Cannot be tested without the real Firebase project and real phones.


## Moderator rank + report review
- Rank: `moderator` is a built-in manual rank (`js/ranks.js`, `min: null`, shield icon, indigo-to-teal gradient). The main admin can restyle it in the Ranks tab like any other rank. Given from "Manage Users & Admins" (new Make / Remove Moderator button, or the Rank drop-down). It is stored as `users.rank = "moderator"`, which only admins can write.
- Permission: `isModerator()` in `config/firestore.rules` reads that same `users.rank`, so the name tag and the permission can never disagree. Moderators can only (a) read OPEN reports about listings / requests / members, plus ones they checked themselves, and (b) update an open report to `status: "checked"` with `modVerdict` (`violation` | `false`), optional `modNote`, `modBy`, `modByName`, `modAt`. No delete, no other fields, never a report they filed or one about themselves. Banned moderators lose it at once.
- Chat reports are NOT visible to moderators: the reporter shares that chat key with admins only (see `js/chat-report.js`).
- Moderator page: `moderator.html` + `js/moderator.js` ("To review" / "My reviews", Violation / False report buttons + note). Nav link "Moderation" is added in `main.js` / `nav-cache.js` for moderators.
- Admin: new "Moderator checked" tab (`js/admin-modreports.js`) lists `status == "checked"` reports with the verdict, who checked, and the note. Admin can delete listing/request, ban, dismiss, Reopen (back to open) or Clear. The main Reports tab only shows `open`, so checked reports move out of it.
- Chat: `nameTagHtml()` / `nameCardHtml()` in `js/ranks.js` draw the other person's name on their rank background (list, header namecard, above each run of their messages). CSS: last block of `css/style.css`.
- MUST republish `config/firestore.rules` (new `isModerator()` + report rules). `config/firestore.dev.rules` regenerated. `functions/points.js` RANK_KEYS edited by hand to match `public/js/points.js`.
- Tests: `tests/moderator.test.mjs` (rank keys in sync, rules text checks). Playwright with Firebase stubbed checked chat tags, moderator page flow and the admin tab. NOT run against real Firestore rules.

## Security + improvement plan (5 Oct 2026): status
- Items 1, 3 (admin cannot write publicKey; chat fingerprint shown), 4 (blurLocation), 6 (banned-IP list admin-only), 7 (adminLog), 10 (dev rules header) were already in the code. Item 2: App Check is wired in `firebase-config.js` and needs your site key (docs/SECURITY_SETUP.md).
- NEW: handover + return confirmation. `js/handover.js`, `handovers/{itemId_borrowerUid}` rules, buttons on the listing card (lender "Handed over"; borrower "I received it" / "I returned it", optional condition note). Stamps use server time and each person can only write their own. Lender's "Mark as Returned" closes the record.
- NEW: overdue reminders (`dueReminders` in functions/index.js): borrower and lender get a polite notice once a loan is past due. Already-returned loans no longer get reminders. Works with push (functions/push.js, push poller).
- MUST republish `config/firestore.rules` (new `handovers` block).
- Not done yet (needs a backend or bigger design): per-user daily caps on chat messages, trusted points (Cloud Function), ratings, reservations/waitlist, wanted alerts, urgent requests, verified community, dispute button, regional languages, impact page.
- Tests: `npm test` (adds tests/handover.test.mjs). Rules were checked as text only, not in the emulator.

## Plan items finished in the last pass (5 Oct 2026)
- Ratings: `js/ratings.js`, rules `ratings/{itemId_raterUid}` (1-5 stars, optional comment, once per listing, never edited, admin can delete). The lender is asked to rate the borrower after "Mark as Returned"; the borrower is asked after "I returned it". The lender's average shows on listing cards. Ratings do NOT change leaderboard points (so colluding accounts cannot inflate rank).
- Dispute button: `js/dispute.js`, report kind `loan` (id `loan_{itemId}_{uid}`). Only the lender or current borrower can file it; moderators cannot see it, admins see it in Reports as "Loan dispute".
- Urgent requests: "Urgent: I need this today" checkbox on requests; saved as `urgent`, shown with a flame, push title changes (`functions/push.js`).
- Impact page: `impact.html` (confirmed returns x rough per-item estimates of money and CO2; constants at the top of its script), linked in the nav.
- Notice board warns "never put private information in a notice" (finding 8).
- Tests: `tests/features.test.mjs`, included in `npm test`. Dev rules regenerated.
- MUST republish `config/firestore.rules` (new `ratings` block, `loan` reports, `urgent` field).

## Still NOT done (needs a backend or a bigger design)
- Per-user daily caps on chat messages / reports (finding 5, needs counter documents or a Cloud Function).
- Trusted points computed by a Cloud Function (finding 9; the function exists but the browser board is still used without Blaze).
- Reservations and waitlist, wanted alerts, verified community (college ID / workplace email), regional languages.
- Real-device checks: rules in the emulator, push delivery, App Check site key.
