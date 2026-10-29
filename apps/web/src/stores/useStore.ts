import type { StoreDto } from '@kirana/shared';
import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** Loads the store (and the caller's role in it) for pages under /stores/:storeId. */
export function useStore(storeId: string) {
  const [store, setStore] = useState<StoreDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    api
      .getStore(storeId)
      .then((r) => live && setStore(r.store))
      .catch((e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [storeId]);
  const canManage = store?.role === 'OWNER' || store?.role === 'MANAGER';
  return { store, setStore, error, canManage };
}
