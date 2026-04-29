import { useEffect, useState } from "react";

import { fetchWorkerHealth } from "../lib/api.js";

export function useWorkerHealth({ refreshMs = 60000 } = {}) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await fetchWorkerHealth();
        if (!cancelled) {
          setHealth(result);
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

  return { health, error };
}
