# Free phone alerts (no card, no Blaze plan)

Phone alerts are sent by a free GitHub Actions job (`.github/workflows/push.yml`) instead of paid
Cloud Functions. Firebase Cloud Messaging and Firestore on the free Spark plan cost nothing.

**How it behaves:** every ~5 minutes the job checks for new listings, requests, offers, borrows and
chat messages and sends a push to phones that turned alerts on. So an alert can arrive a few minutes
after the event (GitHub sometimes delays scheduled jobs by 5-15 minutes). It works with the site closed.

## One-time setup (about 10 minutes, all free)
1. **VAPID key.** Firebase console -> Project settings -> Cloud Messaging -> Web Push certificates ->
   Generate key pair. Paste the *public* key into `VAPID_PUBLIC_KEY` in `public/js/firebase-config.js`.
2. **Rules.** Publish `config/firestore.rules` (Firestore -> Rules), because it contains the `pushTokens` block.
3. **Service account key.** Firebase console -> Project settings -> Service accounts -> "Generate new
   private key". A `.json` file downloads.
4. **GitHub secret.** Repo -> Settings -> Secrets and variables -> Actions -> New repository secret.
   Name: `FIREBASE_SERVICE_ACCOUNT`. Value: paste the ENTIRE contents of the `.json` file.
   Then delete the file from your computer or keep it somewhere private.
5. **Run it once.** Repo -> Actions -> "Send phone alerts" -> Run workflow. The first run only saves a
   starting point ("First run: baseline saved"). From then on it sends.
6. Push the code to GitHub so the site and the workflow are live. On your phone: open the site, log in,
   tap the bell -> "Turn on phone alerts". iPhone: first Share -> Add to Home Screen (iOS 16.4+).

## Keep it safe
- NEVER put the `.json` key in the repo, in `public/`, or in a chat. Anyone with it can edit your database.
  If it leaks: Firebase console -> Service accounts -> manage keys -> delete it, then make a new one.
- Keep the repo **public** for free unlimited Actions minutes (GitHub Pages on a free account needs that too).
  The secret stays hidden even in a public repo.
- GitHub pauses scheduled jobs after 60 days with no commits in a public repo. If alerts stop, open the
  Actions tab and click "Enable workflow".

## Do not run both
Do not deploy the `pushOn...` Cloud Functions as well, or people get every alert twice. Use one or the other.
The leaderboard/expiry/due-reminder functions are separate and still need Blaze; the site works without them.

## Test it
`npm test` runs `tests/push-poller.test.mjs` (fake database, no network).
