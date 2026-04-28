const BASE = "/api";

export async function fetchHealth() {
  const r = await fetch(`${BASE}/health`);
  if (!r.ok) throw new Error(`/api/health ${r.status}`);
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
