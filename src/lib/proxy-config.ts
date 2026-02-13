// Switched to Cloudflare Worker to avoid Vercel timeouts
export const PROXY_WORKER_URL = process.env.NEXT_PUBLIC_CF_WORKER_URL || '';

export function getHlsProxyUrl(targetUrl: string, params: Record<string, string> = {}): string {
    console.log('[Antigravity] Proxy Config Loaded - Worker Disabled:', !PROXY_WORKER_URL);
    const searchParams = new URLSearchParams();
    searchParams.set('url', targetUrl);
    for (const [key, value] of Object.entries(params)) {
        if (value) searchParams.set(key, value);
    }

    // Use Cloudflare Worker if configured, otherwise fallback to local API
    // FORCE LOCAL PROXY: Worker logic is currently failing (403/Challenge from upstream)
    if (PROXY_WORKER_URL) {
        return `${PROXY_WORKER_URL}/api/hls?${searchParams.toString()}`;
    }
    return `/api/hls?${searchParams.toString()}`;
}

export function getSimpleProxyUrl(targetUrl: string, params: Record<string, string> = {}): string {
    const searchParams = new URLSearchParams();
    searchParams.set('url', targetUrl);
    for (const [key, value] of Object.entries(params)) {
        if (value) searchParams.set(key, value);
    }

    // Use Cloudflare Worker if configured, otherwise fallback to local API
    if (PROXY_WORKER_URL) {
        return `${PROXY_WORKER_URL}/api/proxy?${searchParams.toString()}`;
    }
    return `/api/proxy?${searchParams.toString()}`;
}
