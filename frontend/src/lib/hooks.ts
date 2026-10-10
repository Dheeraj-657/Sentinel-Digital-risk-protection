import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "./api";
import { m1, m3 } from "./api";
import { brandUuidFromCuid } from "./brand-bridge";
import type { M1Brand, M3EntityListItem } from "./types";
import { useTenant } from "./tenant";
import { shortId } from "./format";

export interface ApiState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetch-on-mount hook with reload support. `deps` must be primitives that
 * identify the request (e.g. tenant, ids) — the fetcher is read through a
 * ref so it can close over the latest values.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcherRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setData(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

/**
 * Cross-service name resolution. Threat rows carry only UUIDs, so the console
 * joins them client-side: brand UUIDs map back to Sentinel brands through the
 * uuid5 bridge, and entity UUIDs map to Module 3 entities through the list
 * endpoint. Falls back to short IDs when a service is unreachable.
 */
export function useEnrichment() {
  const { tenant } = useTenant();
  const brands = useApi(() => m1.listBrands(), []);
  const entities = useApi(() => m3.listEntities({ limit: 200 }, tenant), [tenant]);

  const entityMap = useMemo(() => {
    const map = new Map<string, M3EntityListItem>();
    for (const entity of entities.data?.items ?? []) map.set(entity.entity_id, entity);
    return map;
  }, [entities.data]);

  const brandMap = useMemo(() => {
    const map = new Map<string, M1Brand>();
    for (const brand of brands.data?.items ?? []) map.set(brandUuidFromCuid(brand.id), brand);
    return map;
  }, [brands.data]);

  const entity = useCallback(
    (entityId: string): M3EntityListItem | undefined => entityMap.get(entityId),
    [entityMap],
  );

  const entityName = useCallback(
    (entityId: string): string =>
      entityMap.get(entityId)?.display_name ?? shortId(entityId),
    [entityMap],
  );

  const brand = useCallback(
    (brandUuid: string): M1Brand | undefined => brandMap.get(brandUuid),
    [brandMap],
  );

  const brandName = useCallback(
    (brandUuid: string): string => brandMap.get(brandUuid)?.name ?? shortId(brandUuid),
    [brandMap],
  );

  return { entity, entityName, brand, brandName, entitiesLoading: entities.loading };
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.message}${err.code ? ` (${err.code})` : ""}`;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
