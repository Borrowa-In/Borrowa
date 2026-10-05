# Security setup (steps only the site owner can do)

## Before deploying the new rules  (IMPORTANT)
1. Sign in as the main admin (shouryaupadhyay50@gmail.com) and open the admin page.
2. If an orange "Verify the admin email" box shows, press **Send verification email**, open the link in that
   inbox, then press **I've verified it**.
3. Only then deploy: `firebase deploy --only firestore:rules`.
   The rules now require a verified email for the main admin. Deploying first would lock admin actions until you verify.

## Turn on App Check (stops scripts calling Firebase directly)
1. Firebase console -> App Check -> register the web app with **reCAPTCHA v3** and copy the site key.
2. Paste the key into `APP_CHECK_SITE_KEY` in `public/js/firebase-config.js`.
3. Test for a few days with enforcement OFF (check the metrics), then enforce for Firestore and Authentication.

## Other notes
- Never deploy `config/firestore.dev.rules` (emulator only). Regenerate it with `python3 scripts/make_dev_rules.py`.
- Admin page -> **Admin log** tab: "Blur old listing locations" rounds the saved GPS point of existing listings.
- Notices are readable by every signed-in member: never put private information in one.
- Still open (needs a backend / bigger change): moving signup + IP limits into Cloud Functions, removing
  `'unsafe-inline'` from the Content Security Policy (inline scripts must be moved into files first), and
  calculating points on a trusted server.
