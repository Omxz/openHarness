import { useMemo } from "react";

export function Header({ runs, autoRefresh, setAutoRefresh, logPath }) {
  const counts = useMemo(() => {
    const c = { done: 0, blocked: 0, failed: 0, running: 0 };
    for (const r of runs) {
      if (c[r.status] !== undefined) c[r.status] += 1;
    }
    return c;
  }, [runs]);

  return (
    <header className="hdr">
      <div className="hdr-left">
        <div className="brand">
          <span className="brand-mark">◐</span>
          <span className="brand-name">openharness</span>
          <span className="brand-tag">operator</span>
        </div>
        <nav className="tabs">
          <button className="tab tab-active">Runs</button>
          <button className="tab" disabled>Workers</button>
          <button className="tab" disabled>Policy</button>
          <button className="tab" disabled>Doctor</button>
        </nav>
      </div>
      <div className="hdr-right">
        <div className="counts">
          <span className="count"><i style={{ background: "var(--ok)" }} />{counts.done} done</span>
          <span className="count"><i style={{ background: "var(--warn)" }} />{counts.blocked} blocked</span>
          <span className="count"><i style={{ background: "var(--err)" }} />{counts.failed} failed</span>
          <span className="count"><i style={{ background: "var(--info)" }} />{counts.running} running</span>
        </div>
        <button
          className={`mini-toggle ${autoRefresh ? "on" : ""}`}
          onClick={() => setAutoRefresh(!autoRefresh)}
          title="Listen to /api/events/stream"
        >
          <span className="dot-live" />
          {autoRefresh ? "Streaming" : "Paused"}
        </button>
        {logPath && <code className="logpath" title={logPath}>{logPath}</code>}
        <button
          className="btn btn-primary"
          disabled
          title="Read-only mode — task creation lands when POST /api/runs does."
        >
          ＋ New task
        </button>
      </div>
    </header>
  );
}
