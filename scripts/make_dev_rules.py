# Regenerates firestore.dev.rules from config/firestore.rules (run after you edit the real rules).
import re
s = open("config/firestore.rules").read()
s = re.sub(r"function isVerified\(\) \{.*?\n    \}\n", "function isVerified() { return request.auth != null; } // DEV ONLY\n", s, count=1, flags=re.S)
s = re.sub(r"function newAccountPostOk\(\) \{.*?\n    \}\n", "function newAccountPostOk() { return true; } // DEV ONLY\n", s, count=1, flags=re.S)
open("config/firestore.dev.rules", "w").write("// ===== DEV / EMULATOR RULES ONLY — NEVER DEPLOY. Generated from firestore.rules. =====\n" + s)
