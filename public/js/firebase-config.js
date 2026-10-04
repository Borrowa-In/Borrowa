import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAViu1MilSQI0rwFyMOMewWzQJ5zuNL1eo",
  authDomain: "ecoshare-547fa.firebaseapp.com",
  projectId: "ecoshare-547fa",
  storageBucket: "ecoshare-547fa.firebasestorage.app",
  messagingSenderId: "591311439371",
  appId: "1:591311439371:web:b8ad3a7a65c0ea300ea90e",
  measurementId: "G-8C34QQLYE0"
};

// DEV / TEST MODE — on ONLY when the page is opened from localhost / 127.0.0.1.
// The deployed site can never turn it on. In dev mode the app talks to the local
// Firebase EMULATORS (fake empty database, no real users) and every anti-abuse limit
// is off: 2-accounts-per-device, duplicate-email key, IP ban gate, "+" alias refusal,
// email-verification requirement and the 3-posts-per-24h new-account cap.
// Start it with:  npm run dev   (see docs/DEV_TESTING.md)
export const DEV_MODE = ["localhost", "127.0.0.1"].includes(window.location.hostname);
export const app = initializeApp(firebaseConfig);
// App Check: paste your reCAPTCHA v3 SITE key (Firebase console -> App Check -> Apps -> Web).
// Left empty it does nothing, so the site keeps working until you set it up.
export const APP_CHECK_SITE_KEY = "";
if (APP_CHECK_SITE_KEY) {
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
}
export const auth = getAuth(app);
export const db = getFirestore(app);
// Photos are stored in Firestore (itemPhotos), not Firebase Storage, so no paid plan is needed.
if (DEV_MODE) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  console.info("[Borrowa] DEV MODE: using local emulators, all limits off.");
}
export const ADMIN_EMAIL = "shouryaupadhyay50@gmail.com";
// Set to true ONLY after you've deployed /functions (needs the Blaze plan).
// While false, the site never tries to call them, so there's no wasted request.
// Who our emails (verification link, password reset) come from while we are in beta.
// Firebase sends them from the project's default address, which is named after the project
// ("ecoshare"). Users are told this so they can spot the mail and find it in spam.
export const MAIL_SENDER_NAME = "ecoshare";
export const MAIL_SENDER_ADDRESS = "noreply@ecoshare-547fa.firebaseapp.com";
export const MAIL_NOTE = `Our emails come from "${MAIL_SENDER_NAME}" (${MAIL_SENDER_ADDRESS}) while Borrowa is in beta. If you don't see it, check Spam/Junk or Promotions and mark it "Not spam".`;
export const USE_CLOUD_FUNCTIONS = false;

// 6-digit email codes as an alternative to the link. Needs the Cloud Functions
// deployed AND the "Trigger Email from Firestore" extension (SMTP) installed.
// Leave false to use the verification link only.
export const EMAIL_OTP_ENABLED = false;

// ---- Phone push notifications (Firebase Cloud Messaging) -----------------
// 1. Firebase console -> Project settings -> Cloud Messaging -> "Web Push certificates"
//    -> Generate key pair, then paste the PUBLIC key below (it is safe to publish).
// 2. Publish the new firestore.rules, then EITHER deploy the Cloud Functions (Blaze plan)
//    OR use the free GitHub Actions sender (docs/FREE_PUSH.md). Not both.
// While this is empty the site hides every notification control, so nothing breaks.
export const VAPID_PUBLIC_KEY = "";
