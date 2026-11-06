const crypto = require("crypto");

// Encrypts stored secrets (SMTP passwords) at rest with AES-256-GCM.
// Key: SECRETS_KEY, falling back to JWT_SECRET (so no new setting is required).
const keyMaterial = () => process.env.SECRETS_KEY || process.env.JWT_SECRET || "change-this-secret-in-production";
const key = () => crypto.createHash("sha256").update(keyMaterial()).digest();

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob) {
  if (!blob) return null;
  try {
    const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null; // key changed / corrupted value
  }
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

module.exports = { encrypt, decrypt, randomToken, sha256 };
