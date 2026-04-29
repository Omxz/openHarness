import { useEffect, useRef, useState } from "react";

import { createRun } from "../lib/api.js";

const PROVIDERS = ["scripted", "ollama", "openai-compatible"];
const PRIVACY_MODES = ["local-only", "ask-before-api"];

export function TaskComposer({ focusKey = 0, onCreated }) {
  const [goal, setGoal] = useState("");
  const [provider, setProvider] = useState("scripted");
  const [privacyMode, setPrivacyMode] = useState("local-only");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const goalRef = useRef(null);

  useEffect(() => {
    if (focusKey > 0) {
      goalRef.current?.focus();
    }
  }, [focusKey]);

  async function submit(event) {
    event.preventDefault();
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const run = await createRun({
        goal: trimmedGoal,
        provider,
        privacyMode,
      });
      setGoal("");
      onCreated?.(run);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="task-composer" onSubmit={submit}>
      <label className="composer-goal">
        <span className="composer-label">Goal</span>
        <textarea
          ref={goalRef}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder='e.g. "Read README.md and summarize it"'
          rows={2}
        />
      </label>
      <div className="composer-controls">
        <label className="composer-field">
          <span className="composer-label">Provider</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            {PROVIDERS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="composer-field">
          <span className="composer-label">Privacy</span>
          <select
            value={privacyMode}
            onChange={(event) => setPrivacyMode(event.target.value)}
          >
            {PRIVACY_MODES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary composer-submit" disabled={!goal.trim() || submitting}>
          {submitting ? "Starting..." : "Run task"}
        </button>
      </div>
      {error && <div className="composer-error">{error.message}</div>}
    </form>
  );
}
