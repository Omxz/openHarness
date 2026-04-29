import { attentionCounts } from "../lib/adapt.js";

export function StatusStrip({ runs, workerHealth, onFocusBucket }) {
  const counts = attentionCounts(runs);
  const codex = workerHealth?.codex;
  const claude = workerHealth?.claude;

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
        <WorkerLight name="Codex" available={codex?.available} detail={codex?.detail} />
        <WorkerLight
          name="Claude"
          available={claude?.available}
          authenticated={claude?.authenticated}
          detail={
            claude?.available
              ? claude?.authenticated
                ? claude?.authDetail ?? "signed in"
                : claude?.authDetail ?? "not signed in"
              : claude?.detail
          }
        />
      </span>
    </div>
  );
}

function WorkerLight({ name, available, authenticated, detail }) {
  let state;
  if (available === undefined) state = "unknown";
  else if (!available) state = "off";
  else if (authenticated === false) state = "warn";
  else state = "on";

  const titleParts = [name];
  if (detail) titleParts.push(detail);

  return (
    <span
      className={`worker-light worker-light-${state}`}
      title={titleParts.join(" · ")}
      data-testid={`worker-light-${name.toLowerCase()}`}
    >
      <span className="worker-light-dot" aria-hidden />
      <span className="worker-light-name">{name}</span>
    </span>
  );
}
