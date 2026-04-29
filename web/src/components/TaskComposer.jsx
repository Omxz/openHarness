import { useEffect, useRef, useState } from "react";

import { createRun } from "../lib/api.js";

const PROVIDERS = [
  "scripted",
  "ollama",
  "openai-compatible",
  "codex-worker",
  "claude-worker",
];
const PRIVACY_MODES = ["local-only", "ask-before-api"];

function workerReadiness(provider, workerHealth) {
  if (!workerHealth) return null;
  if (provider === "codex-worker") {
    const c = workerHealth.codex;
    if (!c) return null;
    if (!c.available) return { state: "warn", text: c.detail || "codex not detected" };
    return { state: "ok", text: c.detail || "ready" };
  }
  if (provider === "claude-worker") {
    const c = workerHealth.claude;
    if (!c) return null;
    if (!c.available) return { state: "warn", text: c.detail || "claude not detected" };
    if (c.authenticated === false) return { state: "warn", text: c.authDetail || "claude not signed in" };
    return { state: "ok", text: c.authDetail || c.detail || "ready" };
  }
  return null;
}

export function TaskComposer({ focusKey = 0, onCreated, onCancel, workerHealth }) {
  const [goal, setGoal] = useState("");
  const defaultProvider = (() => {
    if (workerHealth?.codex?.available) return "codex-worker";
    if (workerHealth?.claude?.available && workerHealth?.claude?.authenticated !== false) return "claude-worker";
    return "scripted";
  })();
  const [provider, setProvider] = useState(defaultProvider);
  const [privacyMode, setPrivacyMode] = useState("local-only");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const goalRef = useRef(null);
  const readiness = workerReadiness(provider, workerHealth);

  useEffect(() => {
    goalRef.current?.focus();
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
    <form className="launcher" onSubmit={submit}>
      <label className="composer-goal">
        <span className="composer-label">Goal</span>
        <textarea
          ref={goalRef}
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder='e.g. "Read README.md and summarize it"'
          rows={3}
        />
      </label>
      <div className="launcher-fields">
        <label className="composer-field">
          <span className="composer-label">Provider</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            {PROVIDERS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          {readiness && (
            <span className={`launcher-readiness launcher-readiness-${readiness.state}`}>
              <span className="launcher-readiness-dot" aria-hidden /> {readiness.text}
            </span>
          )}
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
      </div>
      {error && <div className="launcher-error">{error.message}</div>}
      <div className="launcher-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" disabled={!goal.trim() || submitting}>
          {submitting ? "Starting…" : "Run task"}
        </button>
      </div>
    </form>
  );
}
