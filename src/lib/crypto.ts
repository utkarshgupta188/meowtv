import crypto from 'crypto';

function deriveKey(apiKeyB64: string): Buffer {
  const apiKeyBytes = Buffer.from(apiKeyB64, 'base64');
  const KEY_SUFFIX = process.env.CASTLE_SUFFIX || '';
  const suffixBytes = Buffer.from(KEY_SUFFIX, 'ascii');

  const keyMaterial = Buffer.concat([apiKeyBytes, suffixBytes]);

  if (keyMaterial.length < 16) {
    // Pad with zeros if less than 16 bytes
    const padding = Buffer.alloc(16 - keyMaterial.length);
    return Buffer.concat([keyMaterial, padding]);
  } else if (keyMaterial.length > 16) {
    // Truncate to 16 bytes if more than 16 bytes
    return keyMaterial.subarray(0, 16);
  } else {
    return keyMaterial;
  }
}

/**
 * Decrypts the AES-128-CBC encrypted data from the API.
 * Uses the derived key as both the Key and the IV (as per Kotlin implementation).
 */
export function decryptData(encryptedB64: string, apiKeyB64: string): string | null {
  try {
    const aesKey = deriveKey(apiKeyB64);
    const iv = aesKey; // Kotlin code confirms IV is same as Key

    const encryptedData = Buffer.from(encryptedB64, 'base64');

    const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
    decipher.setAutoPadding(true); // PKCS5Padding is default/compatible with PKCS7

    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}
