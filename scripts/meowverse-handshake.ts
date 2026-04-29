/*
 * Quick handshake checker for MeowVerse.
 * Usage:
 *   npx ts-node scripts/meowverse-handshake.ts --id 81714586 --title "Outlast" [--episode <epId>] [--audio <lang>]
 */

const MAIN_URL = 'https://net22.cc';
const NEW_URL = 'https://net52.cc';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 12; RMX2117 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/147.0.7727.55 Mobile Safari/537.36 /OS.Gatu v3.0';
const HEADERS = {
    'User-Agent': MOBILE_UA,
    'X-Requested-With': 'XMLHttpRequest'
};
const USER_TOKEN = '233123f803cf02184bf6c67e149cdd50';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const arg = (flag: string, fallback: string | undefined = undefined) => {
    const idx = process.argv.indexOf(flag);
    if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
    return fallback;
};

async function bypass(mainUrl: string): Promise<string> {
    // 1. GET mobile home to get addhash
    const res = await fetch(`${mainUrl}/mobile/home?app=1`, {
        headers: {
            'User-Agent': MOBILE_UA,
            'X-Requested-With': 'app.netmirror.netmirrornew'
        }
    });
    const html = await res.text();
    const hashMatch = html.match(/data-addhash="([^"]+)"/);
    if (!hashMatch) throw new Error('Could not find data-addhash');
    const addhash = hashMatch[1];

    // 2. GET userver to register the hash
    const time = Math.floor(Date.now() / 1000);
    await fetch(`https://userver.net52.cc/?jjoii=${addhash}&a=y&t=${time}`, {
        headers: { 'User-Agent': MOBILE_UA }
    });

    // 3. Wait and verify loop (up to 8 times with 10s delay)
    let retries = 0;
    while (retries < 8) {
        console.log(`Bypass polling attempt ${retries + 1}...`);
        await sleep(10000);
        
        try {
            const vRes = await fetch(`${mainUrl}/mobile/verify2.php`, {
                method: 'POST',
                headers: {
                    'User-Agent': MOBILE_UA,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `verify=${addhash}`
            });
            const verifyCheck = await vRes.text();
            
            if (verifyCheck.includes('"statusup":"All Done"')) {
                const setCookie = vRes.headers.get('set-cookie');
                if (setCookie) {
                    const match = setCookie.match(/t_hash_t=([^;]+)/);
                    if (match) return match[1];
                }
            }
        } catch (e) {}
        retries++;
    }
    throw new Error('Bypass failed after max retries');
}

async function fetchEpisodes(movieId: string, cookie: string) {
    const time = Math.floor(Date.now() / 1000);
    const res = await fetch(`${MAIN_URL}/post.php?id=${movieId}&t=${time}`, {
        headers: {
            ...HEADERS,
            'Cookie': `t_hash_t=${cookie}; ott=nf; hd=on; user_token=${USER_TOKEN}`,
            'Referer': `${MAIN_URL}/tv/home`
        }
    });
    const data = await res.json();
    const episodes = Array.isArray(data?.episodes) ? data.episodes : [];
    return { title: data?.title as string | undefined, episodes };
}

async function getPlayHash(episodeId: string, cookie: string) {
    const res = await fetch(`${MAIN_URL}/play.php`, {
        method: 'POST',
        headers: {
            ...HEADERS,
            'Cookie': `t_hash_t=${cookie}; ott=nf; hd=on; user_token=${USER_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `${MAIN_URL}/home`
        },
        body: `id=${episodeId}`
    });
    const text = await res.text();
    try {
        const parsed = JSON.parse(text);
        return typeof parsed?.h === 'string' ? parsed.h : '';
    } catch {
        return '';
    }
}

const mergeCookies = (base: string, setCookieHeader: string | null) => {
    if (!setCookieHeader) return base;
    const map = new Map<string, string>();
    base.split(';').forEach(c => {
        const [k, v] = c.trim().split('=');
        if (k) map.set(k, v || '');
    });
    const parts = setCookieHeader.split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
    parts.forEach(part => {
        const main = part.split(';')[0].trim();
        const [k, v] = main.split('=');
        if (k) map.set(k, v || '');
    });
    return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
};

async function fetchPlaylist(episodeId: string, h: string, tParam: string, tm: number, cookie: string) {
    let cookies = `t_hash_t=${cookie}; ott=nf; hd=on; user_token=${USER_TOKEN}`;
    const headers = { ...HEADERS, 'Cookie': cookies, 'Referer': `${MAIN_URL}/home` } as Record<string, string>;

    // Prime session on net52 with GET play.php + hash if available
    if (h) {
        const play52 = await fetch(`${NEW_URL}/play.php?id=${episodeId}&${h}`, { headers, redirect: 'manual' });
        cookies = mergeCookies(cookies, play52.headers.get('set-cookie'));
    }

    const buildUrl = (base: string) => `${base}/playlist.php?id=${episodeId}&t=${encodeURIComponent(tParam)}&tm=${tm}${h ? `&${h}` : ''}`;
    const primaryUrl = buildUrl(NEW_URL);
    const fallbackUrl = buildUrl(MAIN_URL);

    let body = '';
    let playlistBase = NEW_URL;

    const tryFetch = async (url: string) => {
        const res = await fetch(url, { headers: { ...headers, 'Cookie': cookies } });
        cookies = mergeCookies(cookies, res.headers.get('set-cookie'));
        return res.text();
    };

    body = await tryFetch(primaryUrl);
    if (!body || /Video ID not found!/i.test(body)) {
        body = await tryFetch(fallbackUrl);
        playlistBase = MAIN_URL;
    }

    return { body, playlistBase, cookies };
}

const normalizeFile = (file: string, base: string) => {
    if (file.startsWith('http')) return file;
    if (file.startsWith('//')) return `https:${file}`;
    return `${base}${file.replace('/tv/', '/')}`;
};

async function main() {
    const movieId = arg('--id');
    if (!movieId) {
        console.error('Usage: --id <movieId> [--episode <episodeId>] [--title <title>] [--audio <lang>]');
        process.exit(1);
    }
    const explicitEpisode = arg('--episode');
    const titleOverride = arg('--title', '');
    const audio = arg('--audio', '');

    console.log('Starting handshake...');
    const tHash = await bypass(MAIN_URL);
    console.log('Bypass cookie acquired');

    const { title: fetchedTitle, episodes } = await fetchEpisodes(movieId, tHash);
    const episodeId = explicitEpisode || episodes?.[0]?.id || movieId;
    const titleParam = audio || titleOverride || fetchedTitle || '';
    const tm = Math.floor(Date.now() / 1000);

    console.log(`Using episode: ${episodeId}`);
    const h = await getPlayHash(episodeId, tHash);
    console.log(`play.php hash: ${h || 'none'}`);

    const { body, playlistBase } = await fetchPlaylist(episodeId, h, titleParam, tm, tHash);
    if (!body) {
        console.error('Playlist fetch failed');
        process.exit(1);
    }

    let playlist: any;
    try {
        playlist = JSON.parse(body);
    } catch {
        console.error('Playlist was not JSON. First 200 chars:', body.substring(0, 200));
        process.exit(1);
    }

    const item = Array.isArray(playlist) ? playlist[0] : undefined;
    if (!item || !Array.isArray(item.sources)) {
        console.error('No sources in playlist');
        process.exit(1);
    }

    const sources = item.sources.map((s: any) => ({
        label: s.label || 'Auto',
        url: normalizeFile(String(s.file || ''), playlistBase)
    }));
    const subtitles = Array.isArray(item.tracks) ? item.tracks : [];

    console.log('Playable sources:');
    sources.forEach((s: any) => console.log(`- ${s.label}: ${s.url}`));

    if (subtitles.length) {
        console.log('Subtitles:');
        subtitles.forEach((t: any) => console.log(`- ${t.label || t.language || 'sub'}: ${normalizeFile(String(t.file || ''), playlistBase)}`));
    }

    console.log('Done. Use the HLS URL above with the same Referer and cookies if needed.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
