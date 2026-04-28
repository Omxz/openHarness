export function Inspector({ run, event }) {
  if (!run) return <aside className="insp empty-insp">No run selected.</aside>;
  const target = event ?? run.events?.[0];
  if (!target) {
    return (
      <aside className="insp">
        <div className="insp-head">
          <span className="insp-title">Inspector</span>
          <span className="insp-sub">no events</span>
        </div>
      </aside>
    );
  }

  const json = JSON.stringify(target, null, 2);

  return (
    <aside className="insp">
      <div className="insp-head">
        <span className="insp-title">Inspector</span>
        <span className="insp-sub">{event ? "selected event" : "first event"}</span>
      </div>
      <div className="insp-section">
        <div className="insp-label">type</div>
        <code className="insp-type">{target.type}</code>
      </div>
      <div className="insp-section">
        <div className="insp-label">timestamp</div>
        <code>{target.timestamp}</code>
      </div>
      {target.actor && (
        <div className="insp-section">
          <div className="insp-label">actor</div>
          <code>{target.actor}</code>
        </div>
      )}
      <div className="insp-section">
        <div className="insp-label">raw event</div>
        <pre className="insp-json">{json}</pre>
      </div>
      <div className="insp-section">
        <div className="insp-label">cli equivalents</div>
        <pre className="insp-cmd">{`node bin/harness.mjs show ${run.id} --json
node bin/harness.mjs log .openharness-events.jsonl`}</pre>
      </div>
    </aside>
  );
}
