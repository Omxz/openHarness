import { useEffect, useState } from "react";

import { fetchProviderRegistry } from "../lib/api.js";

export function useProviderRegistry({ refreshMs = 60000 } = {}) {
  const [registry, setRegistry] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await fetchProviderRegistry();
        if (!cancelled) {
          setRegistry(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    }

    load();
    const interval = refreshMs > 0 ? setInterval(load, refreshMs) : null;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [refreshMs]);

  return { registry, error };
}
