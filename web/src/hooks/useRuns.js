import { useEffect, useRef, useState } from "react";

import { fetchRun, fetchRuns } from "../lib/api.js";

const POLL_MS = 2000;

// SSE is the normal live-update path. The polling branch is only a browser
// fallback for environments without EventSource.
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

    const refreshVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", refreshVisible);

    if (typeof EventSource === "undefined") {
      const interval = setInterval(refreshVisible, POLL_MS);
      return () => {
        cancelled = true;
        clearInterval(interval);
        document.removeEventListener("visibilitychange", refreshVisible);
      };
    }

    const events = new EventSource("/api/events/stream");
    events.addEventListener("openharness.ready", refreshVisible);
    events.addEventListener("openharness.event", refreshVisible);
    events.addEventListener("openharness.error", (event) => {
      if (cancelled || !mounted.current) return;
      setError(new Error(event.data || "event stream error"));
    });
    events.onerror = () => {
      if (cancelled || !mounted.current) return;
      setError(new Error("event stream disconnected"));
    };

    return () => {
      cancelled = true;
      events.close();
      document.removeEventListener("visibilitychange", refreshVisible);
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
