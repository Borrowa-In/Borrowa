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
