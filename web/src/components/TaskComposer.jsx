import { useEffect, useMemo, useRef, useState } from "react";

import { createRun } from "../lib/api.js";

const PROVIDERS = [
  "scripted",
  "ollama",
  "openai-compatible",
  "codex-worker",
  "claude-worker",
];
const PRIVACY_MODES = ["local-only", "ask-before-api"];

export function TaskComposer({ focusKey = 0, onCreated, onCancel, providerRegistry }) {
  const [goal, setGoal] = useState("");
  const providerOptions = useMemo(
    () => providerRegistry?.providers?.filter((provider) => provider.runnable !== false) ??
      fallbackProviders(),
    [providerRegistry],
  );
  const defaultProvider = chooseDefaultProvider(providerOptions, providerRegistry);
  const [provider, setProvider] = useState(defaultProvider);
  const [privacyMode, setPrivacyMode] = useState("local-only");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const goalRef = useRef(null);
  const initializedProvider = useRef(false);
  const userPickedProvider = useRef(false);
  const selectedProvider = providerOptions.find((option) => option.id === provider);
  const privacyOptions =
    selectedProvider?.privacyModes?.length ? selectedProvider.privacyModes : PRIVACY_MODES;
  const readiness = providerReadiness(selectedProvider);
  const providerIds = providerOptions.map((option) => option.id).join("|");
  const privacyIds = privacyOptions.join("|");

  useEffect(() => {
    goalRef.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    if (!providerOptions.some((option) => option.id === provider)) {
      setProvider(defaultProvider);
      initializedProvider.current = true;
      return;
    }

    if (providerRegistry && !initializedProvider.current && !userPickedProvider.current) {
      setProvider(defaultProvider);
      initializedProvider.current = true;
    }
  }, [defaultProvider, provider, providerIds, providerOptions, providerRegistry]);

  useEffect(() => {
    if (!privacyOptions.includes(privacyMode)) {
      setPrivacyMode(privacyOptions[0] ?? "local-only");
    }
  }, [privacyMode, privacyIds, privacyOptions]);

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
          <select
            value={provider}
            onChange={(event) => {
              userPickedProvider.current = true;
              setProvider(event.target.value);
            }}
          >
            {providerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label ?? option.id}
              </option>
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
            {privacyOptions.map((value) => (
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

function fallbackProviders() {
  return PROVIDERS.map((id) => ({
    id,
    label: id,
    privacyModes: PRIVACY_MODES,
    readiness: { state: "unknown", detail: "provider registry unavailable" },
  }));
}

function chooseDefaultProvider(providerOptions, providerRegistry) {
  const configuredDefault = providerOptions.find(
    (provider) => provider.id === providerRegistry?.defaultProvider,
  );
  if (configuredDefault && configuredDefault.id !== "scripted") {
    return configuredDefault.id;
  }

  const readyWorker = providerOptions.find(
    (provider) =>
      provider.kind === "subscription-worker" &&
      provider.readiness?.state === "ready",
  );
  return readyWorker?.id ?? configuredDefault?.id ?? "scripted";
}

function providerReadiness(provider) {
  if (!provider?.readiness) return null;
  const state =
    provider.readiness.state === "ready" || provider.readiness.state === "configured"
      ? "ok"
      : "warn";
  return {
    state,
    text: provider.readiness.detail ?? provider.readiness.state,
  };
}
