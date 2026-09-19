import { useEffect, useState } from "react";
import { errorMessage } from "./groups";

// Stable loaders and optional disposal keep route changes from showing stale data.
export function useResource<T>(
  key: string,
  loader: (key: string) => Promise<T>,
  dispose?: (value: T) => void,
) {
  const [revision, setRevision] = useState(0);
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
        if (active) setResult({ key, revision, error: errorMessage(error) });
      });
    return () => {
      active = false;
      if (resource !== undefined) dispose?.(resource);
    };
  }, [key, loader, revision, dispose]);
  const current = result?.key === key && result.revision === revision ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    reload: () => setRevision((value) => value + 1),
  };
}
