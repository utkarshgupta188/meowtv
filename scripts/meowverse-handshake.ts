import * as crypto from 'crypto';
import * as zlib from 'zlib';

const MAIN_URL = process.env.MEOWVERSE_MAIN_URL || 'https://i6a6.t9z0.com';
const DEVICE_ID = process.env.MEOWVERSE_DEVICE_ID || '2987149b2e2a63b2';
const GAID = process.env.MEOWVERSE_GAID || '';
const SECRET_KEY_ENCRYPTED = process.env.MEOWVERSE_SECRET_KEY_ENCRYPTED || '';
const DES_KEY = process.env.MEOWVERSE_DES_KEY || '';
const DES_IV = process.env.MEOWVERSE_DES_IV || '';
const AES_KEY = process.env.MEOWVERSE_AES_KEY || '';
const AES_IV = process.env.MEOWVERSE_AES_IV || '';
const WS_SECRET = process.env.MEOWVERSE_WS_SECRET || '';

function des3Decrypt(encryptedBase64: string): string {
    const key = Buffer.from(DES_KEY).subarray(0, 24);
    const iv = Buffer.from(DES_IV);
    const decipher = crypto.createDecipheriv('des-ede3-cbc', key, iv);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function aesDecrypt(encryptedBase64: string): string {
    try {
        const key = Buffer.from(AES_KEY);
        const iv = Buffer.from(AES_IV);
        const data = Buffer.from(encryptedBase64, 'base64');
        
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(false); 
        const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

        let resultText = '';
        try {
            resultText = zlib.gunzipSync(decrypted).toString('utf8');
        } catch (e) {
            resultText = decrypted.toString('utf8');
        }

        // HEURISTIC: Strip everything after the last valid JSON closing character
        // This handles cases where CBC padding (nulls or PKCS7) remains after decryption
        const lastBrace = resultText.lastIndexOf('}');
        const lastBracket = resultText.lastIndexOf(']');
        const cutAt = Math.max(lastBrace, lastBracket);
        if (cutAt !== -1) {
            return resultText.substring(0, cutAt + 1);
        }
        return resultText.trim();
    } catch (e) {
        console.error('[aesDecrypt] Error:', e);
        return '';
    }
}

function md5(text: string): string {
    return crypto.hash('md5', text, 'hex');
}

function getHeaders(curTime: string, secret: string, token: string) {
    return {
        'androidid': DEVICE_ID,
        'app_id': 'cinetvin',
        'app_language': 'en',
        'channel_code': 'cinetvin_3001',
        'cur_time': curTime,
        'device_id': DEVICE_ID,
        'en_al': '0',
        'gaid': GAID,
        'Host': 'i6a6.t9z0.com',
        'is_display': 'GMT+05:30',
        'is_language': 'en',
        'is_vvv': '0',
        'mob_mfr': 'google',
        'mobmodel': 'Pixel 5',
        'package_name': 'com.cti.cinetvin',
        'sign': md5(secret + DEVICE_ID + curTime).toUpperCase(),
        'sys_platform': '2',
        'sysrelease': '13',
        'token': token || '',
        'User-Agent': 'okhttp/4.11.0',
        'version': '30000',
        'Content-Type': 'application/x-www-form-urlencoded'
    };
}

async function main() {
    console.log('--- CineTv Handshake ---');

    if (!SECRET_KEY_ENCRYPTED || !DES_KEY || !AES_KEY) {
        console.error('Error: Missing required environment variables (MEOWVERSE_SECRET_KEY_ENCRYPTED, MEOWVERSE_DES_KEY, MEOWVERSE_AES_KEY).');
        console.error('Please ensure they are set in your environment or .env file.');
        process.exit(1);
    }

    const vodId = process.argv[3] || '248593';

    const secret = des3Decrypt(SECRET_KEY_ENCRYPTED);
    console.log('Secret decrypted');

    const curTime = Date.now().toString();
    
    console.log('Initializing device...');
    const initRes = await fetch(`${MAIN_URL}/api/public/init`, {
        method: 'POST',
        headers: getHeaders(curTime, secret, ''),
        body: 'invited_by=&is_install=1'
    });

    const initText = await initRes.text();
    const decrypted = aesDecrypt(initText.trim());
    console.log('Decrypted init:', decrypted.slice(0, 100) + '...');
    const initJson = JSON.parse(decrypted);
    const token = initJson.result?.user_info?.token;
    console.log(`Token: ${token}`);

    console.log(`Fetching info for ID: ${vodId}...`);
    const infoTime = Date.now().toString();
    const p2pSalt = process.env.MEOWVERSE_P2P_SALT || 'Zox882LYjEn4Rqpa';
    const p2pToken = md5(p2pSalt + DEVICE_ID + vodId + infoTime).toUpperCase();
    const infoRes = await fetch(`${MAIN_URL}/api/vod/info_new`, {
        method: 'POST',
        headers: getHeaders(infoTime, secret, token),
        body: `sign=${p2pToken}&vod_id=${vodId}&cur_time=${infoTime}&audio_type=0`
    });

    const infoText = await infoRes.text();
    const infoJson = JSON.parse(aesDecrypt(infoText.trim()));

    if (infoJson.result) {
        const info = infoJson.result;
        console.log(`Title: ${info.vod_name}`);
        const collections = info.vod_collection || [];
        const rawUrl = collections[0]?.vod_url || info.vod_url;
        console.log(`Raw URL: ${rawUrl}`);

        const parsedUrl = new URL(rawUrl);
        const path = parsedUrl.pathname;
        const expiry = Math.floor(Date.now() / 1000) + (5 * 60 * 60);
        const wsTime = expiry.toString(16);
        const wsSecret = md5(WS_SECRET + path + wsTime);
        const signedUrl = `${rawUrl}?wsSecret=${wsSecret}&wsTime=${wsTime}`;
        console.log(`Signed URL: ${signedUrl}`);

        const rangeRes = await fetch(signedUrl, { 
            headers: { 
                'User-Agent': 'okhttp/4.11.0',
                'Range': 'bytes=0-10'
            } 
        });
        console.log('Status:', rangeRes.status);
        console.log('Content-Length:', rangeRes.headers.get('content-length'));
        console.log('Content-Range:', rangeRes.headers.get('content-range'));
    }

    console.log('Testing search for "2024"...');
    const searchTime = Date.now().toString();
    const searchRes = await fetch(`${MAIN_URL}/api/search/result`, {
        method: 'POST',
        headers: getHeaders(searchTime, secret, token),
        body: 'kw=2024&pn=1'
    });
    const searchText = await searchRes.text();
    const searchDecrypted = aesDecrypt(searchText.trim());
    const searchJson = JSON.parse(searchDecrypted);
    console.log(`Search found ${searchJson.result?.length || 0} items.`);

    console.log('Done.');
}

main().catch(console.error);
