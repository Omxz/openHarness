import { attentionCounts } from "../lib/adapt.js";

export function StatusStrip({ runs, providerRegistry, onFocusBucket }) {
  const counts = attentionCounts(runs);
  const workerProviders =
    providerRegistry?.providers?.filter((provider) => provider.kind === "subscription-worker") ??
    fallbackWorkerProviders();

  return (
    <div className="status-strip" role="status" aria-label="Operator status">
      <button
        type="button"
        className={`status-segment status-attention${counts.needsYou > 0 ? " is-active" : ""}`}
        onClick={() => onFocusBucket?.("needs-you")}
        title="Runs awaiting human action"
        data-testid="status-attention"
      >
        <span className="status-glyph" aria-hidden>!</span>
        <span className="status-count">{counts.needsYou}</span>
        <span className="status-label">Needs you</span>
      </button>
      <button
        type="button"
        className={`status-segment status-running${counts.active > 0 ? " is-active" : ""}`}
        onClick={() => onFocusBucket?.("active")}
        title="Runs currently in flight"
        data-testid="status-running"
      >
        <span className="status-pulse" aria-hidden />
        <span className="status-count">{counts.active}</span>
        <span className="status-label">Running</span>
      </button>

      <span className="status-sep" aria-hidden />

      <span className="status-readiness" data-testid="status-readiness">
        <span className="status-readiness-label">Workers</span>
        {workerProviders.map((provider) => (
          <ProviderLight key={provider.id} provider={provider} />
        ))}
      </span>
    </div>
  );
}

function ProviderLight({ provider }) {
  const state = readinessLight(provider.readiness?.state);
  const label = provider.label ?? provider.id;
  const titleParts = [label, provider.readiness?.detail ?? provider.readiness?.state];

  return (
    <span
      className={`worker-light worker-light-${state}`}
      title={titleParts.filter(Boolean).join(" · ")}
      data-testid={`worker-light-${label.toLowerCase()}`}
    >
      <span className="worker-light-dot" aria-hidden />
      <span className="worker-light-name">{label}</span>
    </span>
  );
}

function readinessLight(state) {
  if (state === "ready" || state === "configured") return "on";
  if (state === "auth-required" || state === "needs-config") return "warn";
  if (state === "unavailable") return "off";
  return "unknown";
}

function fallbackWorkerProviders() {
  return [
    { id: "codex-worker", label: "Codex", readiness: { state: "unknown" } },
    { id: "claude-worker", label: "Claude", readiness: { state: "unknown" } },
  ];
}
