import { createFileRoute } from '@tanstack/react-router';
import { auth } from '~/server/auth.server';

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        return auth.handler(await buildAuthRequest(request, params));
      },
      POST: async ({ request, params }) => {
        return auth.handler(await buildAuthRequest(request, params));
      },
    },
  },
});

const buildAuthRequest = async (
  request: Request,
  params: Record<string, unknown>,
) => {
  const splat = (params as { _splat?: string })._splat ?? '';
  const pathSegment = splat.replace(/^\/+/, '').replace(/\/+$/, '');
  const url = new URL(request.url);
  const routeBase = auth.options?.basePath ?? '/api/auth';
  const cleanedBase = routeBase.replace(/^\/+/, '').replace(/\/+$/, '');
  const basePath = cleanedBase ? `/${cleanedBase}` : '/api/auth';
  const newPath = pathSegment ? `${basePath}/${pathSegment}` : basePath;
  const newUrl = new URL(newPath + url.search, url.origin);

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buffer = await request.clone().arrayBuffer();
    if (buffer.byteLength > 0) {
      body = buffer;
    }
  }

  return new Request(newUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body,
    redirect: request.redirect,
    signal: request.signal,
  });
};
