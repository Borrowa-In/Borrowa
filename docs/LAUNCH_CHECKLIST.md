# Borrowa launch checklist

## Firebase console
1. **Auth -> Settings -> Authorized domains**: add your real domain (e.g. borrowa.in).
2. **Make emails say Borrowa** (this is a console setting, not code):
   - Project settings -> General -> **Public-facing name** = `Borrowa`.
   - Authentication -> Templates -> edit **Email address verification**, **Password reset** (and any others): set Sender name `Borrowa`, a Subject like `Verify your email for Borrowa`, and rewrite the message. Do not use `%APP_NAME%` if the public name isn't updated yet.
   - Optional: in the same template, **Customize domain** to send from `noreply@yourdomain` instead of `noreply@ecoshare-547fa.firebaseapp.com` (needs DNS records on your domain).
3. **Admin**: register `shouryaupadhyay50@gmail.com` yourself first. Add a second admin from the admin page.
4. **App Check**: register the web app with reCAPTCHA v3, paste the site key into `APP_CHECK_SITE_KEY` in `public/js/firebase-config.js`, watch metrics for a few days, then click Enforce.
5. **Billing**: Blaze plan, then set a budget alert (e.g. Rs 500).

## Phone push notifications (only you can do these)
1. **Billing**: switch the project to the **Blaze** plan (card needed; cost is ~0 at this scale). Push needs Cloud Functions.
2. **VAPID key**: Firebase console -> Project settings -> **Cloud Messaging** -> Web Push certificates -> **Generate key pair**. Paste the PUBLIC key into `VAPID_PUBLIC_KEY` in `public/js/firebase-config.js`.
3. **Deploy**: `firebase deploy --only firestore:rules,firestore:indexes` then `cd functions && npm install && npm run sync-points && cd .. && firebase deploy --only functions` (Node 22 runtime).
4. **Restrict the Firebase API key**: Google Cloud console -> APIs & Services -> Credentials -> the browser key -> Application restrictions: **HTTP referrers** (your domain and `YOUR-USERNAME.github.io/*`). Keep the Firebase APIs allowed (incl. Cloud Messaging / FCM Registrations and Installations).
5. **App Check**: finish step 4 above (reCAPTCHA v3), watch the metrics, then Enforce.
6. **Authorized domains**: your real domain and `YOUR-USERNAME.github.io` under Authentication -> Settings.
7. **Real phone tests** (cannot be tested without them): Android Chrome (turn alerts on, close the tab, post an item from another account); iPhone (iOS 16.4+, Share -> Add to Home Screen, open from the icon, turn alerts on); check the tap opens the right page; log out and confirm that phone stops getting alerts.
8. **Security headers**: they live in `firebase.json` and only apply on Firebase Hosting. GitHub Pages ignores them (the per-page CSP `<meta>` tags still apply). After deploying to Firebase Hosting check with `curl -I https://YOUR-DOMAIN/home.html` and `curl -I https://YOUR-DOMAIN/sw.js` (sw.js must say `no-cache`).

## Emails landing in spam
Firebase's default sender (`noreply@ecoshare-547fa.firebaseapp.com`) is shared infrastructure, so Gmail/Outlook often junk it. The app can't change that; these console steps help, most effective first:
1. **Authentication -> Templates -> Email address verification -> Customize domain** and send from your own domain (needs a domain you own plus the DNS records Firebase shows: SPF/DKIM). This is the real fix.
2. Same template: Sender name `Borrowa`, a plain subject (`Verify your email for Borrowa`), short message, no all-caps or "!!!".
3. Until then the site tells users the mail comes from "ecoshare" (`MAIL_SENDER_*` in `public/js/firebase-config.js`: change those if you change the sender) and to check Spam/Junk and mark it "Not spam".

## Photos and devices
- Photos don't use Firebase Storage. They're shrunk in the browser (about 45 KB) and saved in their own `itemPhotos/{listingId}` documents, NOT on the listing, so Browse stays light. A photo is fetched only when someone opens a listing's details popup. Listings made with old Storage photos still show them. Deleting a listing deletes its photo; if an admin deletes through another route, an orphan photo doc may remain and is harmless.
- Account limits: a device can hold up to 2 accounts; banning someone in the admin page also blocks their devices; Gmail dot-variants count as one email. To release a device, delete or edit its doc under `devices` in the console. Incognito/another browser gets a fresh device ID, so this stops casual repeat offenders, not determined ones.

## New-account limit
An account younger than 24 hours can post at most 3 listings (counter in `postCounts/{uid}`, enforced by `config/firestore.rules`). To raise or lower it, change `NEW_ACCOUNT_LIMIT` in `js/main.js` and the `<= 3` in `newAccountPostOk()` in the rules. To let someone post more, an admin can edit their `postCounts` doc.

## Free plan (Spark) vs paid (Blaze)
Borrowa runs free for everyone. The only paid-plan feature is Cloud Functions (scheduled jobs, 6-digit email codes).
Without them: expired listings are hidden and cleaned up by the owner's browser, and borrowers see an in-app "due / overdue" banner on Browse. Email, SMS and phone push notifications need Blaze (push: see the section above).
A billing alert only matters if you upgrade to Blaze. Skip it on Spark.

## Email privacy
Emails now live in `userPrivate/{uid}` (owner + admins only). Each member's old public email is removed automatically the next time they log in. Old listings may still carry a `userEmail` field until they expire or are deleted.

## Email verification
- Works now with the link Firebase emails at sign-up. New members land on `verify.html`, which auto-continues once they click it.
- Optional 6-digit code: deploy functions, install the **Trigger Email from Firestore** extension (SMTP, collection `mail`), then set `EMAIL_OTP_ENABLED = true` in `public/js/firebase-config.js`.

## Deploy
```
firebase deploy --only firestore:rules,firestore:indexes
cd functions && npm install && npm run sync-points && cd ..
firebase deploy --only functions
# set USE_CLOUD_FUNCTIONS = true in public/js/firebase-config.js
firebase deploy --only hosting
```
Then connect your domain: Hosting -> Add custom domain.

## Test on real phones (10 friends)
Sign up, verify email, forgot password, post (food + non-food), borrow with a due date, chat, report a listing, check nav and modals at 360px width.

## Not built yet
Appeals form (admins now review reports in the Reports tab), phone OTP, photo moderation, per-unit postings, email notifications, ratings, account settings/deletion, search + pagination, skeletons, Firestore backups, Crashlytics/Sentry, college-email badge.


## Phone alerts WITHOUT a paid plan
Use the free GitHub Actions sender: follow `docs/FREE_PUSH.md` (skip the Blaze/Cloud Functions steps above).
