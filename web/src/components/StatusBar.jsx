export function StatusBar({ runs, logPath, tailing }) {
  const totalEvents = runs.reduce((a, r) => a + (r.eventCount ?? 0), 0);
  return (
    <footer className="status-bar">
      <span>
        {tailing && <span className="dot-live" />}
        {tailing ? " tailing " : " paused "}
        {logPath ?? ".openharness-events.jsonl"} · {runs.length} runs · {totalEvents} events
      </span>
      <span className="dim">v0.0.1 · local · read-only</span>
    </footer>
  );
}
