import { useMemo } from "react";

export function Header({
  runs,
  autoRefresh,
  setAutoRefresh,
  logPath,
  onNewTask,
  theme,
  onToggleTheme,
  inspectorOpen,
  onToggleInspector,
}) {
  const counts = useMemo(() => {
    const c = { done: 0, blocked: 0, failed: 0, running: 0, cancelled: 0 };
    for (const r of runs) {
      if (c[r.status] !== undefined) c[r.status] += 1;
    }
    return c;
  }, [runs]);
  const nextTheme = theme === "dark" ? "light" : "dark";

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
          <span className="count"><i style={{ background: "var(--warn)" }} />{counts.cancelled} cancelled</span>
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
        {onToggleInspector && (
          <button
            type="button"
            className={`theme-toggle${inspectorOpen ? " is-on" : ""}`}
            onClick={onToggleInspector}
            title={`${inspectorOpen ? "Hide" : "Show"} inspector (i)`}
            aria-label={`${inspectorOpen ? "Hide" : "Show"} inspector`}
            data-testid="inspector-toggle"
            aria-pressed={inspectorOpen ? "true" : "false"}
          >
            ⊞
          </button>
        )}
        {onToggleTheme && (
          <button
            type="button"
            className="theme-toggle"
            onClick={onToggleTheme}
            title={`Switch to ${nextTheme} theme`}
            aria-label={`Switch to ${nextTheme} theme`}
            data-testid="theme-toggle"
          >
            {theme === "dark" ? "☾" : "☀"}
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={onNewTask}
          title="Open launcher (⌘K or N)"
          data-testid="new-task"
        >
          + New task
          <kbd>⌘K</kbd>
        </button>
      </div>
    </header>
  );
}
