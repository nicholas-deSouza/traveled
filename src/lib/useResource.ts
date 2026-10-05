import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./groups";

// Stable loaders and optional disposal keep route changes from showing stale data.
export function useResource<T>(
  key: string,
  loader: (key: string) => Promise<T>,
  dispose?: (value: T) => void,
  options?: { keepPreviousData?: boolean; retainOnError?: (error: unknown) => boolean },
) {
  // Disposed resources (such as gallery blob URLs) cannot be reused safely.
  const keepPreviousData = options?.keepPreviousData === true && !dispose;
  const retainOnError = options?.retainOnError;
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const [result, setResult] = useState<{
    key: string;
    revision: number;
    data?: T;
    error?: string;
  }>();
  useEffect(() => {
    let active = true;
    let resource: T | undefined;
    loader(key)
      .then((data) => {
        if (!active) {
          dispose?.(data);
          return;
        }
        resource = data;
        setResult({ key, revision, data });
      })
      .catch((error) => {
        if (active) setResult(previous => ({ key, revision, error: errorMessage(error),
          data: keepPreviousData && (!retainOnError || retainOnError(error)) && previous?.key === key ? previous.data : undefined }));
      });
    return () => {
      active = false;
      if (resource !== undefined) dispose?.(resource);
    };
  }, [key, loader, revision, dispose, keepPreviousData, retainOnError]);
  const current = result?.key === key && result.revision === revision ? result : undefined;
  const data = current?.data ?? (keepPreviousData && result?.key === key ? result.data : undefined);
  return {
    data,
    error: current?.error,
    loading: !current && data === undefined,
    refreshing: !current && data !== undefined,
    reload,
  };
}
