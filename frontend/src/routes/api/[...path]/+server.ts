import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const BACKEND_URL = env.BACKEND_URL;

export const fallback: RequestHandler = async ({ request, url }) => {
    try {
        const path = url.pathname.replace(/^\/api/, '') + url.search;
        const proxyUrl = `${BACKEND_URL}/api${path}`;

        // Clone the request to forward it to the backend natively
        const newReq = new Request(proxyUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            // @ts-expect-error Next line required to pass through body stream
            duplex: 'half'
        });

        // Remove host header to avoid conflicts
        newReq.headers.delete("host");

        const proxyResponse = await fetch(newReq);
        if (!proxyResponse.ok) {
            const body = await proxyResponse.text();
            console.error(
                `[proxy] ${request.method} ${url.pathname} → ${proxyResponse.status}: ${body}`
            );
            return new Response(body, {
                status: proxyResponse.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return proxyResponse;
    } catch (err: any) {
        console.error(`[proxy] ${request.method} ${url.pathname} threw:`, err);
        throw error(500, `Error proxying request: ${err.message}`);
    }
};
