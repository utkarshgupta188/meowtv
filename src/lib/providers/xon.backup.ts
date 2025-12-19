/**
 * xon.ts
 *
 * Decrypts enc2: lines inside HLS playlists
 * Matches Cloudstream Utils.kt logic exactly
 *
 * Requirements:
 *   Node.js >= 18
 *
 * Usage:
 *   node xon.ts < input.m3u8 > output.m3u8
 *   OR
 *   node xon.ts   (then paste playlist, end with CTRL+D / CTRL+Z+Enter)
 */

import crypto from "crypto";
import fs from "fs";

/* ===============================
   CONSTANTS (from Utils.kt)
   =============================== */

// STREAM_SECRET (base64 decoded)
const STREAM_SECRET = Buffer.from(
  "cG1TMENBTUcxUnVxNDlXYk15aEUzZmgxc091TFlFTDlydEZhellZbGpWSTJqNEJQU29nNzNoVzdBN3hNaGNlSEQwaXdyUHJWVkRYTHZ4eVdy",
  "base64"
).toString("utf8");

const ENC_PREFIX = "enc2:";

/* ===============================
   HELPERS
   =============================== */

function base64UrlToBuffer(input: string): Buffer {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return Buffer.from(s, "base64");
}

function deriveKeySha256(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/* ===============================
   enc2 AES-256-GCM DECRYPTOR
   =============================== */

function decryptEnc2(line: string): string {
  if (!line.startsWith(ENC_PREFIX)) return line;

  const raw = line.slice(ENC_PREFIX.length);
  const blob = base64UrlToBuffer(raw);

  if (blob.length <= 12) {
    throw new Error("enc2 blob too short");
  }

  // Layout:
  // [ 12 bytes IV ][ ciphertext ][ 16 bytes auth tag ]
  const iv = blob.subarray(0, 12);
  const encrypted = blob.subarray(12);

  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);

  const key = deriveKeySha256(STREAM_SECRET);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const plain =
    decipher.update(ciphertext, undefined, "utf8") +
    decipher.final("utf8");

  return plain;
}

/* ===============================
   PLAYLIST PROCESSOR
   =============================== */

function decryptPlaylist(m3u8: string): string {
  return m3u8
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (/^enc\d+:/i.test(trimmed)) {
        try {
          return decryptEnc2(trimmed);
        } catch {
          return line;
        }
      }
      return line;
    })
    .join("\n");
}

/* ===============================
   CLI ENTRYPOINT
   =============================== */

const input = fs.readFileSync(0, "utf8"); // stdin
const output = decryptPlaylist(input);
process.stdout.write(output);
