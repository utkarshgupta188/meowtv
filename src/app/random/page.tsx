import { redirect } from 'next/navigation';
import { fetchHome } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function RandomPage() {
    let targetUrl = '/';

    try {
        const rowPromises = await fetchHome();
        const rowsArrays = await Promise.all(rowPromises);
        const allRows = rowsArrays.flat();
        const candidateIds = Array.from(
            new Set(
                allRows
                    .flatMap((r) => r?.contents ?? [])
                    .map((c) => c?.id)
                    .filter((v): v is string => Boolean(v))
            )
        );

        if (candidateIds.length > 0) {
            const randomIndex = Math.floor(Math.random() * candidateIds.length);
            const randomId = candidateIds[randomIndex];
            targetUrl = `/watch/${encodeURIComponent(randomId)}`;
        }
    } catch (e) {

    }

    // Now redirect outside the try-catch so it won't be swallowed
    redirect(targetUrl);
}
