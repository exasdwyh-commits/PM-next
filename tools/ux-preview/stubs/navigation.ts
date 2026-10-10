import { useSyncExternalStore } from 'react';
function subscribe(cb: () => void) { window.addEventListener('popstate', cb); return () => window.removeEventListener('popstate', cb); }
export function usePathname() { return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/muse'); }
export function useRouter() { return {
  push: (href: string) => { window.dispatchEvent(new CustomEvent('preview-navigate', { detail: href })); },
  replace: (href: string) => { window.dispatchEvent(new CustomEvent('preview-navigate', { detail: href })); },
  refresh: () => {},
  prefetch: () => {},
  back: () => window.history.back(),
}; }
export function useSearchParams() { return new URLSearchParams(window.location.search); }
