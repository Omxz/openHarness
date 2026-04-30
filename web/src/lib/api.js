const BASE = "/api";

export async function fetchHealth() {
  const r = await fetch(`${BASE}/health`);
  if (!r.ok) throw new Error(`/api/health ${r.status}`);
  return r.json();
}

export async function fetchWorkerHealth({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${BASE}/health/workers`);
  if (!r.ok) throw new Error(`/api/health/workers ${r.status}`);
  return r.json();
}

export async function fetchProviderRegistry({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${BASE}/providers`);
  if (!r.ok) throw new Error(`/api/providers ${r.status}`);
  return r.json();
}

export async function fetchRuns() {
  const r = await fetch(`${BASE}/runs`);
  if (!r.ok) throw new Error(`/api/runs ${r.status}`);
  const body = await r.json();
  return body.runs ?? [];
}

export async function fetchRun(id) {
  const r = await fetch(`${BASE}/runs/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`/api/runs/${id} ${r.status}`);
  const body = await r.json();
  return body.run ?? null;
}

export async function createRun(input, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${BASE}/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = await r.json();

  if (!r.ok) {
    throw new Error(body.error?.message ?? `/api/runs ${r.status}`);
  }

  return body.run ?? null;
}

export async function cancelRun(id, options = {}, { fetchImpl = fetch } = {}) {
  const reason =
    typeof options?.reason === "string" && options.reason.trim()
      ? options.reason.trim()
      : undefined;
  const r = await fetchImpl(`${BASE}/runs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  const body = await r.json();
  if (!r.ok) {
    throw new Error(body.error?.message ?? `/api/runs/${id}/cancel ${r.status}`);
  }
  return body.run ?? null;
}

export async function fetchApprovals({ fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${BASE}/approvals`);
  if (!r.ok) throw new Error(`/api/approvals ${r.status}`);
  const body = await r.json();
  return body.approvals ?? [];
}

export function approveApproval(id, options = {}, { fetchImpl = fetch } = {}) {
  return decideApproval(id, "approve", options, { fetchImpl });
}

export function denyApproval(id, options = {}, { fetchImpl = fetch } = {}) {
  return decideApproval(id, "deny", options, { fetchImpl });
}

async function decideApproval(id, action, options, { fetchImpl }) {
  const reason =
    typeof options?.reason === "string" && options.reason.trim()
      ? options.reason.trim()
      : undefined;
  const r = await fetchImpl(
    `${BASE}/approvals/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
  const body = await r.json();
  if (!r.ok) {
    throw new Error(body.error?.message ?? `/api/approvals/${id}/${action} ${r.status}`);
  }
  return body.approval ?? null;
}
