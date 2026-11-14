import { useEffect, useState } from 'react';
import { UUID_RE } from '../../supabase/functions/_shared/logic';

export type Route = { name: 'home' } | { name: 'deal'; id: string; paid: boolean } | { name: 'not_found' };

export function parseRoute(pathname: string, search: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const m = /^\/d\/([^/]+)\/?$/.exec(pathname);
  if (m && UUID_RE.test(m[1])) return { name: 'deal', id: m[1].toLowerCase(), paid: new URLSearchParams(search).get('paid') === '1' };
  return { name: 'not_found' };
}

export function navigate(to: string) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const read = () => parseRoute(window.location.pathname, window.location.search);
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}
