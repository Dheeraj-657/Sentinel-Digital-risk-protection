/** Curated, deterministic word lists used by analyzers and rules. */

export const SUSPICIOUS_HOST_KEYWORDS = [
  "secure", "security", "verify", "verification", "login", "signin", "sign-in", "account", "accounts", "update",
  "support", "help", "helpdesk", "service", "customer", "care", "wallet", "auth", "unlock", "recover", "recovery",
  "billing", "payment", "refund", "bonus", "gift", "reward", "rewards", "claim", "promo", "giveaway", "airdrop",
  "free", "official", "confirm", "alert", "suspended", "limited", "webscr", "portal",
  "outlet", "sale", "discount", "deals", "clearance", "offer", "offers",
];

/** Lure themes common in scam domains (smishing, refund and prize fraud). */
export const LURE_TERMS: Record<string, string[]> = {
  delivery: ["parcel", "delivery", "redelivery", "redeliver", "customs", "shipment", "tracking", "courier", "fee"],
  refund: ["refund", "taxrefund", "rebate", "reimburse", "compensation"],
  prize: ["prize", "winner", "lottery", "jackpot", "sweepstake"],
};

export const SUSPICIOUS_PATH_KEYWORDS = [
  "login", "signin", "verify", "account", "secure", "update", "wallet", "auth", "password", "billing",
  "claim", "reward", "gift", "confirm", "webscr", "unlock", "kyc", "seed", "recover",
];

/** TLDs disproportionately abused for phishing/scams (based on public abuse reporting trends). */
export const RISKY_TLDS = new Set([
  "top", "xyz", "click", "live", "icu", "buzz", "rest", "cfd", "sbs", "monster", "zip", "mov", "cyou",
  "quest", "lol", "bond", "support", "online", "site", "store", "shop", "work", "fit", "gq", "tk", "ml", "cf", "ga",
]);

export const FREE_HOSTING_SUFFIXES = [
  "netlify.app", "vercel.app", "github.io", "pages.dev", "firebaseapp.com", "web.app", "000webhostapp.com",
  "weebly.com", "wixsite.com", "blogspot.com", "glitch.me", "herokuapp.com", "repl.co", "replit.app",
  "webflow.io", "framer.website", "notion.site", "sites.google.com", "azurewebsites.net", "r2.dev", "workers.dev",
];

export const URL_SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "cutt.ly", "rb.gy", "shorturl.at", "rebrand.ly", "s.id",
]);

/** Phrases strongly associated with scams/fraud solicitation. Grouped by theme for explanations. */
export const SCAM_PHRASES: Record<string, string[]> = {
  credential: [
    "verify your account", "confirm your identity", "account has been suspended", "account will be suspended",
    "unusual activity", "update your payment", "enter your password", "login to continue", "re-activate", "reactivate your",
  ],
  solicitation: [
    "dm us", "dm me", "send us a dm", "message us on whatsapp", "contact us on telegram", "whatsapp", "telegram",
    "share your account number", "send your details", "account number", "otp", "one-time code",
  ],
  giveaway: [
    "giveaway", "claim your reward", "claim now", "you have won", "winner", "free money", "cash prize", "gift card",
    "limited time", "first 100", "double your", "airdrop", "send 1", "get 2 back",
  ],
  urgency: ["urgent", "act now", "within 24 hours", "immediately", "final notice", "last chance"],
  crypto: ["bitcoin", "btc", "eth", "usdt", "crypto", "wallet connect", "seed phrase", "recovery phrase"],
};

export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "proton.me", "protonmail.com", "aol.com", "icloud.com",
  "mail.com", "gmx.com", "yandex.com", "zoho.com", "tutanota.com",
]);

export const VERIFICATION_LOOKALIKES = ["✔", "✓", "✅", "☑", "verified", "official", "real", "authentic"];

export const SUPPORT_TERMS = ["support", "help", "care", "service", "assist", "helpdesk", "customercare", "team", "desk"];

/** Android permissions that enable fraud (OTP theft, overlay attacks, remote control). */
export const DANGEROUS_PERMISSIONS: Record<string, string> = {
  "android.permission.READ_SMS": "read SMS messages (OTP interception)",
  "android.permission.RECEIVE_SMS": "receive SMS messages (OTP interception)",
  "android.permission.SEND_SMS": "send SMS messages",
  "android.permission.BIND_ACCESSIBILITY_SERVICE": "accessibility control (screen reading / remote actions)",
  "android.permission.SYSTEM_ALERT_WINDOW": "draw over other apps (overlay phishing)",
  "android.permission.BIND_DEVICE_ADMIN": "device administrator (prevents uninstall)",
  "android.permission.REQUEST_INSTALL_PACKAGES": "install other packages",
  "android.permission.READ_CONTACTS": "read contacts",
  "android.permission.READ_CALL_LOG": "read call log",
  "android.permission.QUERY_ALL_PACKAGES": "enumerate installed apps (banking-app targeting)",
};
