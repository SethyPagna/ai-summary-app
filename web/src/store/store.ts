// A tiny external store for React (useSyncExternalStore), plus the hash router.

import { useSyncExternalStore } from 'react';

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useSelector<T extends object, R>(store: ReturnType<typeof createStore<T>>, select: (s: T) => R): R {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

export type DocTab = 'brief' | 'ask' | 'study' | 'map' | 'compare' | 'source';
export const DOC_TABS: DocTab[] = ['brief', 'ask', 'study', 'map', 'compare'];

export type Route = { name: 'home' } | { name: 'doc'; docId: string; tab: DocTab; other?: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'doc' && parts[1]) {
    const tab = (DOC_TABS as string[]).includes(parts[2] ?? '') || parts[2] === 'source' ? (parts[2] as DocTab) : 'brief';
    return { name: 'doc', docId: parts[1], tab, other: parts[3] };
  }
  return { name: 'home' };
}

export function routeHash(r: Route): string {
  if (r.name === 'doc') return `#/doc/${encodeURIComponent(r.docId)}/${r.tab}${r.other ? '/' + encodeURIComponent(r.other) : ''}`;
  return '#/';
}
