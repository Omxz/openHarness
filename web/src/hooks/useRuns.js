import { useEffect, useRef, useState } from "react";

import { fetchRun, fetchRuns } from "../lib/api.js";

const POLL_MS = 2000;

// Draft polling hook. The plan flags this for refinement — visibility-pause,
// error backoff, and selective re-fetch of the picked run are decisions worth
// making explicitly. This first pass: poll /api/runs every 2s while tailing
// AND the tab is visible; refetch the selected run on every tick.
export function useRuns({ selectedId, tailing }) {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const next = await fetchRuns();
        if (cancelled || !mounted.current) return;
        setRuns(next);
        setError(null);
      } catch (err) {
        if (cancelled || !mounted.current) return;
        setError(err);
      } finally {
        if (!cancelled && mounted.current) setLoading(false);
      }
    }

    tick();
    if (!tailing) return () => { cancelled = true; };

    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tailing]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    fetchRun(selectedId)
      .then((r) => {
        if (!cancelled && mounted.current) setSelected(r);
      })
      .catch((err) => {
        if (!cancelled && mounted.current) setError(err);
      });
    return () => { cancelled = true; };
  }, [selectedId, runs]);

  return { runs, selected, error, loading };
}
