const STATUS = {
  done:      { label: "done",      color: "var(--ok)"   },
  blocked:   { label: "blocked",   color: "var(--warn)" },
  failed:    { label: "failed",    color: "var(--err)"  },
  running:   { label: "running",   color: "var(--info)" },
  cancelled: { label: "cancelled", color: "var(--warn)" },
};

export function StatusPill({ status, size = "sm" }) {
  const s = STATUS[status] ?? STATUS.running;
  return (
    <span
      className={`pill pill-${size}`}
      style={{ color: s.color, borderColor: s.color + "55" }}
    >
      <span
        className="pill-dot"
        style={{
          background: s.color,
          boxShadow: status === "running" ? `0 0 0 3px ${s.color}22` : "none",
        }}
      />
      {s.label}
      {status === "running" && <span className="pill-pulse" />}
    </span>
  );
}
