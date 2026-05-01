import { 
    Provider, 
    HomePageRow, 
    ContentItem, 
    MovieDetails, 
    Episode, 
    VideoResponse,
    Track,
    Season
} from './types';
import { getHlsProxyUrl, getSimpleProxyUrl } from '../proxy-config';
import * as crypto from 'crypto';
import * as zlib from 'zlib';

const MAIN_URL = 'https://i6a6.t9z0.com';
const DEVICE_ID = '2987149b2e2a63b2';
const GAID = '';
const SECRET_KEY_ENCRYPTED = process.env.MEOWVERSE_SECRET_KEY_ENCRYPTED || '';
const DES_KEY = process.env.MEOWVERSE_DES_KEY || '';
const DES_IV = process.env.MEOWVERSE_DES_IV || '';
const AES_KEY = process.env.MEOWVERSE_AES_KEY || '';
const AES_IV = process.env.MEOWVERSE_AES_IV || '';
const WS_SECRET = process.env.MEOWVERSE_WS_SECRET || '';

let cachedSecret: string | null = null;
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// --- Crypto Helpers ---

function des3Decrypt(encryptedBase64: string): string {
    try {
        const key = Buffer.from(DES_KEY).subarray(0, 24);
        const iv = Buffer.from(DES_IV);
        const decipher = crypto.createDecipheriv('des-ede3-cbc', key, iv);
        decipher.setAutoPadding(true);
        let decrypted = decipher.update(encryptedBase64, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('[MeowVerse] DES3 decryption failed', e);
        return '';
    }
}

/**
 * Re-implemented to match Python's behavior: decrypt raw CBC and then GZIP decompress.
 * Python's cipher.decrypt() doesn't unpad, so we handle possible trailing bytes.
 */
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
        console.error('[MeowVerse] AES decryption failed', e);
        return '';
    }
}

function md5(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
}

function generateSign(secret: string, curTime: string): string {
    return md5((secret || '') + DEVICE_ID + curTime).toUpperCase();
}

function generateP2PToken(vodId: string, timestamp: string): string {
    const salt = process.env.MEOWVERSE_P2P_SALT || 'Zox882LYjEn4Rqpa';
    return md5(salt + DEVICE_ID + vodId + timestamp).toUpperCase();
}

// --- API Helpers ---

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
        'log-header': 'I am the log request header.',
        'mob_mfr': 'google',
        'mobmodel': 'Pixel 5',
        'package_name': 'com.cti.cinetvin',
        'sign': generateSign(secret, curTime),
        'sys_platform': '2',
        'sysrelease': '13',
        'token': token,
        'User-Agent': 'okhttp/4.11.0',
        'version': '30000',
        'Content-Type': 'application/x-www-form-urlencoded'
    };
}

async function ensureToken() {
    if (!cachedSecret) {
        cachedSecret = des3Decrypt(SECRET_KEY_ENCRYPTED);
    }

    if (cachedToken && Date.now() < tokenExpiresAt) {
        return { secret: cachedSecret, token: cachedToken };
    }

    const curTime = Date.now().toString();
    const headers = getHeaders(curTime, cachedSecret, '');
    const body = new URLSearchParams({ invited_by: '', is_install: '1' });

    try {
        const res = await fetch(`${MAIN_URL}/api/public/init`, {
            method: 'POST',
            headers,
            body: body.toString()
        });

        const text = await res.text();
        const jsonText = text.startsWith('{') ? text : aesDecrypt(text.trim());
        const data = JSON.parse(jsonText?.trim() || '{}');
        cachedToken = data.result?.user_info?.token || '';
        tokenExpiresAt = Date.now() + 3600 * 1000;
    } catch (e) {
        console.error('[MeowVerse] ensureToken failed', e);
    }

    return { secret: cachedSecret, token: cachedToken || '' };
}

// --- Provider Implementation ---

function generateByteRangeM3u8(url: string, size: number, chunkMB: number = 10): string {
    const chunkSize = chunkMB * 1024 * 1024;
    const numChunks = Math.ceil(size / chunkSize);
    let m3u8 = "#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:60\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n\n";
    
    for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const length = i === numChunks - 1 ? size - start : chunkSize;
        // Approximation: 10MB ~ 10-20 seconds of 1080p video, 60s is safe TargetDuration
        m3u8 += `#EXTINF:30.0,\n#EXT-X-BYTERANGE:${length}@${start}\n${url}\n`;
    }
    
    m3u8 += "#EXT-X-ENDLIST";
    const base64 = Buffer.from(m3u8).toString('base64');
    return `data:application/x-mpegurl;base64,${base64}`;
}

async function searchRecommend(page: number): Promise<ContentItem[]> {
    const { secret, token } = await ensureToken();
    const curTime = Date.now().toString();
    const headers = getHeaders(curTime, secret, token);
    const body = new URLSearchParams({ pn: page.toString() });

    try {
        const res = await fetch(`${MAIN_URL}/api/search/recommend`, {
            method: 'POST',
            headers,
            body: body.toString()
        });

        const text = await res.text();
        const decrypted = aesDecrypt(text.trim());
        const data = JSON.parse(decrypted?.trim() || '{}');
        const results = data.result || [];

        return results.map((item: any) => ({
            id: String(item.id),
            title: item.vod_name,
            coverImage: item.vod_pic,
            type: item.type_pid === 2 ? 'series' : 'movie'
        }));
    } catch (e) {
        console.error('[MeowVerse] searchRecommend failed', e);
        return [];
    }
}

async function topicVodList(topicId: string, page: number): Promise<ContentItem[]> {
    const { secret, token } = await ensureToken();
    const curTime = Date.now().toString();
    const headers = getHeaders(curTime, secret, token);
    const body = new URLSearchParams({ 
        topic_id: topicId,
        pn: page.toString() 
    });

    try {
        const res = await fetch(`${MAIN_URL}/api/topic/vod_list`, {
            method: 'POST',
            headers,
            body: body.toString()
        });

        const text = await res.text();
        const decrypted = aesDecrypt(text.trim());
        const data = JSON.parse(decrypted?.trim() || '{}');
        const results = data.result?.vod_list || [];

        return results.map((item: any) => ({
            id: String(item.id),
            title: item.vod_name,
            coverImage: item.vod_pic,
            type: item.type_pid === 2 ? 'series' : 'movie'
        }));
    } catch (e) {
        console.error(`[MeowVerse] topicVodList(${topicId}) failed`, e);
        return [];
    }
}

export const MeowVerseProvider: Provider = {
    name: 'MeowVerse',

    async fetchHome(page: number): Promise<Promise<HomePageRow[]>[]> {
        if (page > 1) return [];

        const categories = [
            { id: "1", name: "Recommended" },
            { id: "4008", name: "Trending Now" },
            { id: "4464", name: "Most Popular" },
            { id: "4009", name: "Hottest International Films" },
            { id: "4134", name: "This Month: You Can't Miss" },
            { id: "4004", name: "Top Series This Week" }
        ];

        return categories.map(async (cat) => {
            const items = cat.id === "1" 
                ? await searchRecommend(page)
                : await topicVodList(cat.id, page);
            
            return [{
                name: cat.name,
                contents: items
            }];
        });
    },

    async search(query: string): Promise<ContentItem[]> {
        const { secret, token } = await ensureToken();
        const curTime = Date.now().toString();
        const headers = getHeaders(curTime, secret, token);
        const body = new URLSearchParams({ kw: query, pn: '1' });

        try {
            const res = await fetch(`${MAIN_URL}/api/search/result`, {
                method: 'POST',
                headers,
                body: body.toString()
            });

            const text = await res.text();
            const decrypted = aesDecrypt(text.trim());
            const data = JSON.parse(decrypted?.trim() || '{}');
            const results = data.result || [];

            return results.map((item: any) => ({
                id: String(item.id),
                title: item.vod_name,
                coverImage: item.vod_pic,
                type: 'movie'
            }));
        } catch (e) {
            console.error('[MeowVerse] search failed', e);
            return [];
        }
    },

    async fetchDetails(id: string, includeEpisodes: boolean = true): Promise<MovieDetails | null> {
        const { secret, token } = await ensureToken();
        const curTime = Date.now().toString();
        const headers = getHeaders(curTime, secret, token);
        const p2pToken = generateP2PToken(id, curTime);
        const body = new URLSearchParams({
            sign: p2pToken,
            vod_id: id,
            cur_time: curTime,
            audio_type: '0'
        });

        try {
            const res = await fetch(`${MAIN_URL}/api/vod/info_new`, {
                method: 'POST',
                headers,
                body: body.toString()
            });

            const text = await res.text();
            const decrypted = aesDecrypt(text.trim());
            const data = JSON.parse(decrypted?.trim() || '{}');
            const info = data.result;
            try {
                require('fs').appendFileSync('meowverse.log', `[${new Date().toISOString()}] INFO KEYS: ${Object.keys(info || {}).join(', ')}\n`);
                if (info) require('fs').appendFileSync('meowverse.log', `[${new Date().toISOString()}] FULL INFO: ${JSON.stringify(info)}\n`);
            } catch(e) {}

            if (!info) return null;

            const audioOptions = info.audio_type_option || [];
            const audioTracks: Track[] = audioOptions.length > 0 
                ? audioOptions.map((opt: any) => ({
                    name: opt.title || opt.type_name || 'Language',
                    languageId: opt.type
                }))
                : (info.vod_writer ? info.vod_writer.split(',').map((t: string, idx: number) => ({
                    name: t.trim().toUpperCase() === 'HIN' ? 'Hindi' : 
                          t.trim().toUpperCase() === 'ENG' ? 'English' : t.trim(),
                    languageId: idx + 1
                })) : []);

            const episodes: Episode[] = [];
            const collections = info.vod_collection || [];

            for (const col of collections) {
                episodes.push({
                    id: String(col.id || `${id}:${col.title || col.episode_no}`),
                    title: col.title || `Episode ${col.episode_no}`,
                    season: 1,
                    number: parseInt(col.episode_no || '1'),
                    sourceMovieId: id,
                    description: col.vod_name,
                    tracks: audioTracks
                });
            }

            if (episodes.length === 0) {
                episodes.push({
                    id: id,
                    title: info.vod_name,
                    season: 1,
                    number: 1,
                    sourceMovieId: id,
                    tracks: audioTracks
                });
            }

            const seriesInfo = info.series_info || [];
            const seasons: Season[] = seriesInfo.map((s: any) => ({
                id: String(s.vod_id),
                number: parseInt(s.series?.replace('Season ', '') || '1') || 1,
                name: s.series || 'Season 1'
            }));

            return {
                id: id,
                title: info.vod_name,
                description: info.vod_blurb,
                coverImage: info.vod_pic,
                backgroundImage: info.vod_pic_bg,
                year: parseInt(info.vod_year || '0'),
                score: parseFloat(info.vod_score || '0'),
                episodes: includeEpisodes ? episodes : [],
                seasons: seasons.length > 0 ? seasons : [{ id: id, number: 1, name: 'Season 1' }]
            };
        } catch (e) {
            console.error('[MeowVerse] fetchDetails failed', e);
            return null;
        }
    },

    async fetchStreamUrl(movieId: string, episodeId: string, languageId?: number | string): Promise<VideoResponse | null> {
        console.log('[MeowVerse] fetchStreamUrl', { movieId, episodeId, languageId });
        try {
            const { secret, token } = await ensureToken();
            const curTime = Date.now().toString();
            const p2pToken = generateP2PToken(movieId, curTime);
            const headers = getHeaders(curTime, secret, token);

            const body = new URLSearchParams({
                sign: p2pToken,
                vod_id: movieId,
                cur_time: curTime,
                audio_type: (languageId || '0').toString()
            });
            const res = await fetch(`${MAIN_URL}/api/vod/info_new`, {
                method: 'POST',
                headers,
                body: body.toString()
            });

            const text = await res.text();
            const decrypted = aesDecrypt(text.trim());
            const data = JSON.parse(decrypted?.trim() || '{}');
            const info = data.result;
            try {
                require('fs').appendFileSync('meowverse.log', `[${new Date().toISOString()}] STREAM INFO: ${JSON.stringify(info)}\n`);
            } catch(e) {}
            if (!info) return null;

            const collections = info.vod_collection || [];
            let rawUrl = info.vod_url;
            
            if (episodeId !== movieId) {
                const ep = collections.find((c: any) => String(c.id) === episodeId);
                if (ep) rawUrl = ep.vod_url;
            }

            if (!rawUrl) return null;

            // wsSecret/wsTime signing
            const parsedUrl = new URL(rawUrl);
            const path = parsedUrl.pathname;
            const expiry = Math.floor(Date.now() / 1000) + (5 * 60 * 60);
            const wsTime = expiry.toString(16);
            const raw = WS_SECRET + path + wsTime;
            const wsSecret = md5(raw);
            
            const signedUrl = `${rawUrl}?wsSecret=${wsSecret}&wsTime=${wsTime}`;
            
            // Use global proxy helpers (Cloudflare Worker if configured) to avoid Vercel bandwidth costs
            const isM3u8 = signedUrl.includes('.m3u8');
            const finalUrl = isM3u8 
                ? getHlsProxyUrl(signedUrl, { ua: 'okhttp/4.11.0' })
                : getSimpleProxyUrl(signedUrl, { ua: 'okhttp/4.11.0' });

            return {
                videoUrl: finalUrl,
                qualities: [{ quality: 'Auto', url: finalUrl }],
                subtitles: [],
                headers: { 'User-Agent': 'okhttp/4.11.0' }
            };
        } catch (e) {
            console.error('[MeowVerse] fetchStreamUrl failed', e);
            return null;
        }
    }
};
