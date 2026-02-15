import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ALLOWED_PROVIDERS = ['MeowTV', 'MeowVerse', 'MeowToon'];

export function middleware(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');

    if (provider && ALLOWED_PROVIDERS.includes(provider)) {
        // Create a response that redirects to the same URL but without the 'provider' param
        const newUrl = new URL(request.url);
        newUrl.searchParams.delete('provider');

        const response = NextResponse.redirect(newUrl);

        // Set the provider cookie on the response
        // secure: process.env.NODE_ENV === 'production' (Next.js automatically handles this if we don't specify)
        // but explicit is good.
        const isProd = process.env.NODE_ENV === 'production';

        response.cookies.set('provider', provider, {
            path: '/',
            httpOnly: true,
            sameSite: 'strict',
            secure: isProd,
        });

        return response;
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
