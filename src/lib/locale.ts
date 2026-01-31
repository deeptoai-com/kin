import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { getCookie, getLocale } from 'intlayer';

export const getLocaleServer = createServerFn().handler(async () => {
  const { headers } = getRequest();
  const cookieString = headers.get('cookie') ?? '';
  const locale = await getLocale({
    getCookie: (name) => getCookie(name, cookieString),
    getHeader: (name) => headers.get(name) ?? undefined,
  });

  return { locale };
});
