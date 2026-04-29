import { useState } from "react";

import { pendingApprovalIndicator } from "../lib/adapt.js";
import { approveApproval, cancelRun, denyApproval } from "../lib/api.js";
import { buildActivityCards } from "../lib/activity.js";
import { fmtDur, fmtTimeMs } from "../lib/format.js";
import { StatusPill } from "./StatusPill.jsx";
import { Timeline } from "./Timeline.jsx";

const STATUS_COLOR = {
  done: "var(--ok)",
  blocked: "var(--warn)",
  failed: "var(--err)",
  running: "var(--info)",
  cancelled: "var(--warn)",
};

export function RunDetail({ run, onPickEvent, pickedEvent }) {
  if (!run) return <section className="detail empty-detail">Select a run.</section>;

  const pending = pendingApprovalIndicator(run);
  const canCancel = run.status === "running" || run.pendingApproval;
  const showLiveOutput =
    run.status === "running" &&
    (run.partialStdout?.length || run.partialStderr?.length);
  const activityCards = buildActivityCards(run);

  return (
    <section className="detail">
      {run.pendingApproval && (
        <PendingApprovalPanel run={run} />
      )}

      <div className="detail-head">
        <div className="detail-head-top">
          <StatusPill status={run.status} size="md" />
          <code className="run-id">{run.id}</code>
          {pending && (
            <span
              className="pill pill-md"
              data-testid="pending-approval"
              style={{ color: "var(--warn)", borderColor: "var(--warn)" }}
            >
              <span className="pill-pulse" />
              {pending.label} · {pending.tool}
            </span>
          )}
          {run.startedAt && <span className="dim">started {fmtTimeMs(run.startedAt)}</span>}
          {run.endedAt && <span className="dim">· ended {fmtTimeMs(run.endedAt)}</span>}
          {run.durationMs != null && <span className="dim">· {fmtDur(run.durationMs)}</span>}
          {canCancel && <CancelRunButton runId={run.id} />}
        </div>
        <h1 className="goal">{run.goal ?? "(no goal)"}</h1>
        <div className="kv-grid">
          <KV k="provider" v={run.provider ? <code>{run.provider}</code> : <span className="dim">—</span>} />
          <KV k="model"    v={run.model ? <code>{run.model}</code> : <span className="dim">—</span>} />
          <KV k="config"   v={run.config ? <code>{run.config}</code> : <span className="dim">—</span>} />
          <KV k="exit"     v={run.exitCode != null ? <code>{run.exitCode}</code> : <span className="dim">—</span>} />
        </div>
        {run.reason && (
          <div className="reason" style={{ color: STATUS_COLOR[run.status] }}>
            <span className="reason-label">{run.status} reason</span>
            <div className="reason-body" style={{ color: "var(--fg-2)" }}>{run.reason}</div>
          </div>
        )}
      </div>

      {activityCards.length > 0 && (
        <OperatorActivityPanel cards={activityCards} running={run.status === "running"} />
      )}

      {showLiveOutput && (
        <div className="panel" data-testid="live-worker-output">
          <div className="panel-head">
            <span className="panel-title">Live worker output</span>
            <span className="panel-sub">streaming · still running</span>
          </div>
          {run.partialStdout && (
            <pre className="output" data-testid="live-worker-stdout">
              {run.partialStdout}
              {run.partialStdoutTruncated ? "\n…(truncated)" : ""}
            </pre>
          )}
          {run.partialStderr && (
            <pre
              className="output"
              data-testid="live-worker-stderr"
              style={{ color: "var(--err)" }}
            >
              {run.partialStderr}
              {run.partialStderrTruncated ? "\n…(truncated)" : ""}
            </pre>
          )}
        </div>
      )}

      {run.final && (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Worker output</span>
            <span className="panel-sub">final assistant message</span>
          </div>
          <pre className="output">{run.final}</pre>
        </div>
      )}

      {run.verification && (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Verification</span>
            <span
              className="panel-sub"
              style={{ color: run.verification.exitCode === 0 ? "var(--ok)" : "var(--err)" }}
            >
              {run.verification.exitCode === 0 ? "passed" : "failed"}
            </span>
          </div>
          <div className="verify-body">
            <VerifyRow k="exit" v={<code>{String(run.verification.exitCode)}</code>} />
            {run.verification.command && (
              <VerifyRow k="command" v={<code>{run.verification.command}</code>} />
            )}
            {run.verification.stdout && (
              <VerifyRow k="stdout" v={<code>{clip(run.verification.stdout)}</code>} />
            )}
            {run.verification.stderr && (
              <VerifyRow k="stderr" v={<code>{clip(run.verification.stderr)}</code>} />
            )}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Event timeline</span>
          <span className="panel-sub">{run.eventCount} events from .openharness-events.jsonl</span>
        </div>
        <Timeline events={run.events} onPick={onPickEvent} pickedTs={pickedEvent?.timestamp} />
      </div>
    </section>
  );
}

function OperatorActivityPanel({ cards, running }) {
  return (
    <div className="panel" data-testid="operator-activity">
      <div className="panel-head">
        <span className="panel-title">Operator activity</span>
        <span className="panel-sub">
          {running ? "live" : "latest"} · {cards.length} cards
        </span>
      </div>
      <div className="activity-grid">
        {cards.map((card) => (
          <div
            key={card.id}
            className={`activity-card activity-card-${card.tone ?? "idle"}`}
          >
            <span className="activity-dot" aria-hidden />
            <div className="activity-copy">
              <span className="activity-title">{card.title}</span>
              {card.detail && <span className="activity-detail">{card.detail}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  );
}

function VerifyRow({ k, v }) {
  return (
    <div className="verify-row">
      <span className="dim">{k}</span>
      {v}
    </div>
  );
}

function clip(s, n = 200) {
  if (s == null) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function CancelRunButton({ runId }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleClick() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelRun(runId);
    } catch (err) {
      setError(err.message ?? "Failed to cancel run");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-warn"
        data-testid="cancel-run-button"
        disabled={submitting}
        onClick={handleClick}
      >
        {submitting ? "Cancelling…" : "Cancel"}
      </button>
      {error && (
        <span
          className="dim"
          data-testid="cancel-run-error"
          style={{ color: "var(--err)" }}
        >
          {error}
        </span>
      )}
    </>
  );
}

function PendingApprovalPanel({ run }) {
  const [submitting, setSubmitting] = useState(null);
  const [error, setError] = useState(null);
  const details = run.pendingApprovalDetails;
  const tool = details?.toolName ?? run.pendingApprovalTool ?? "tool";
  const risk = details?.risk ?? "?";
  const reason = details?.reason ?? null;
  const approvalId = run.pendingApprovalId ?? details?.approvalId ?? null;
  const inputJson = details?.input ? JSON.stringify(details.input, null, 2) : null;

  async function handleDecide(action) {
    if (!approvalId || submitting) return;
    setSubmitting(action);
    setError(null);
    try {
      if (action === "approve") {
        await approveApproval(approvalId);
      } else {
        await denyApproval(approvalId);
      }
    } catch (err) {
      setError(err.message ?? `Failed to ${action} approval`);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div
      className="panel approval-panel"
      data-testid="pending-approval-panel"
    >
      <div className="panel-head">
        <span className="panel-title">Approval required</span>
        <span className="panel-sub">
          {tool} · {risk} risk
        </span>
      </div>
      <div className="verify-body">
        <div className="verify-row">
          <span className="dim">tool</span>
          <code>{tool}</code>
        </div>
        <div className="verify-row">
          <span className="dim">risk</span>
          <code>{risk}</code>
        </div>
        {reason && (
          <div className="verify-row">
            <span className="dim">reason</span>
            <span>{reason}</span>
          </div>
        )}
        {approvalId && (
          <div className="verify-row">
            <span className="dim">id</span>
            <code>{approvalId}</code>
          </div>
        )}
        {inputJson && (
          <div className="verify-row">
            <span className="dim">input</span>
            <pre className="output" style={{ margin: 0 }}>{inputJson}</pre>
          </div>
        )}
      </div>
      <div className="approval-actions">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="approve-button"
          disabled={!approvalId || submitting !== null}
          onClick={() => handleDecide("approve")}
        >
          {submitting === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          className="btn btn-warn"
          data-testid="deny-button"
          disabled={!approvalId || submitting !== null}
          onClick={() => handleDecide("deny")}
        >
          {submitting === "deny" ? "Denying…" : "Deny"}
        </button>
        {!approvalId && (
          <span className="dim">(no approval id available — approve via CLI)</span>
        )}
      </div>
      {error && (
        <div
          className="approval-error"
          data-testid="pending-approval-error"
        >
          {error}
        </div>
      )}
    </div>
  );
}
