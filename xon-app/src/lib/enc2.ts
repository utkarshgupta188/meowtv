import crypto from 'crypto';

const STREAM_SECRET = Buffer.from(
  'cG1TMENBTUcxUnVxNDlXYk15aEUzZmgxc091TFlFTDlydEZhellZbGpWSTJqNEJQU29nNzNoVzdBN3hNaGNlSEQwaXdyUHJWVkRYTHZ4eVdy',
  'base64'
).toString('utf-8');

function deriveKeySha256(): Buffer {
  return crypto.createHash('sha256').update(STREAM_SECRET).digest();
}

function base64UrlToBytes(b64url: string): Buffer {
  let s = b64url.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad !== 0) s += '='.repeat(4 - pad);
  return Buffer.from(s, 'base64');
}

export function decryptStream(value: string | null): string | null {
  if (!value || !value.startsWith('enc2:')) return value;

  try {
    const blob = base64UrlToBytes(value.substring(5));
    if (blob.length <= 12) return null;

    const iv = blob.subarray(0, 12);
    const ctAndTag = blob.subarray(12);
    const authTagLength = 16;
    if (ctAndTag.length <= authTagLength) return null;

    const ciphertext = ctAndTag.subarray(0, ctAndTag.length - authTagLength);
    const authTag = ctAndTag.subarray(ctAndTag.length - authTagLength);

    const key = deriveKeySha256();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    return null;
  }
}

export function decryptInline(value: string): string {
  if (!value.includes('enc2:')) return value;
  if (value.startsWith('enc2:')) {
    const decrypted = decryptStream(value);
    return (decrypted ?? value).split(/\r?\n/)[0].trim();
  }
  return value.replace(/enc2:[A-Za-z0-9_-]+/g, (token) => decryptStream(token) ?? token);
}

export function decryptPlaylist(text: string, baseUrl: string): string {
  const resolveUrl = (maybeRelative: string) => {
    try {
      return new URL(maybeRelative, baseUrl).toString();
    } catch {
      return maybeRelative;
    }
  };

  const rewriteUriAttributes = (line: string) => {
    let out = decryptInline(line);

    out = out.replace(/(URI|KEYFORMATURI)="([^"]+)"/gi, (_match, key, uri) => {
      const resolved = resolveUrl(decryptInline(uri));
      return `${key}="${resolved}"`;
    });

    out = out.replace(/(URI|KEYFORMATURI)=([^,\s]+)/gi, (_match, key, uri) => {
      if (uri.startsWith('"')) return `${key}=${uri}`;
      const resolved = resolveUrl(decryptInline(uri));
      return `${key}=${resolved}`;
    });

    return out;
  };

  return text
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line;
      if (line.startsWith('#')) return rewriteUriAttributes(line);
      const resolved = resolveUrl(decryptInline(line.trim()));
      return resolved;
    })
    .join('\n');
}
