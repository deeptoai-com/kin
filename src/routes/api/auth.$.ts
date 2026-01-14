import { createFileRoute } from '@tanstack/react-router';
import { auth } from '~/server/auth.server';

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        // Better Auth handler needs the full path
        // The $ param (splat) contains the path after /api/auth/
        const pathSegment = (params as { _splat?: string })._splat || '';
        const url = new URL(request.url);
        
        // Reconstruct the full pathname: /api/auth/{pathSegment}
        // This ensures Better Auth handler receives the correct path
        const fullPath = `/api/auth/${pathSegment}`;
        const newUrl = new URL(fullPath + url.search, url.origin);
        
        // Create a new request with the corrected URL
        const newRequest = new Request(newUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' && request.body ? await request.clone().arrayBuffer() : undefined,
        });
        
        return auth.handler(newRequest);
      },
      POST: async ({ request, params }) => {
        const pathSegment = (params as { _splat?: string })._splat || '';
        const url = new URL(request.url);
        const fullPath = `/api/auth/${pathSegment}`;
        const newUrl = new URL(fullPath + url.search, url.origin);
        
        // For POST, we need to preserve the body
        const body = await request.clone().arrayBuffer();
        const newRequest = new Request(newUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: body.byteLength > 0 ? body : undefined,
        });
        
        return auth.handler(newRequest);
      },
    },
  },
});
