import { groupRunsByAttention } from "../lib/adapt.js";
import { fmtDur, fmtRel } from "../lib/format.js";
import { FilterChips } from "./FilterChips.jsx";
import { StatusPill } from "./StatusPill.jsx";

const BUCKET_LABELS = {
  active: "Active",
  "needs-you": "Needs you",
  recent: "Recent",
};
const BUCKET_ORDER = ["active", "needs-you", "recent"];

export function RunsList({ runs, selectedId, onSelect, filters, setFilters }) {
  const filtered = runs.filter((r) => {
    if (filters.status !== "all" && r.status !== filters.status) return false;
    if (filters.provider !== "all" && r.provider !== filters.provider) return false;
    if (filters.q && !r.goal?.toLowerCase().includes(filters.q.toLowerCase())) return false;
    return true;
  });
  const providers = Array.from(new Set(runs.map((r) => r.provider).filter(Boolean)));
  const groups = groupRunsByAttention(filtered);

  return (
    <aside className="runs">
      <div className="runs-toolbar">
        <input
          className="search"
          placeholder="Filter goals…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <div className="filter-row">
          <FilterChips
            label="status"
            value={filters.status}
            options={["all", "done", "blocked", "running", "cancelled"]}
            onChange={(v) => setFilters({ ...filters, status: v })}
          />
        </div>
        {providers.length > 0 && (
          <div className="filter-row">
            <FilterChips
              label="provider"
              value={filters.provider}
              options={["all", ...providers]}
              onChange={(v) => setFilters({ ...filters, provider: v })}
            />
          </div>
        )}
      </div>
      <div className="runs-meta">
        <span>{filtered.length} runs</span>
        <span className="dim">grouped by attention</span>
      </div>
      <div className="runs-list">
        {filtered.length === 0 && <div className="empty">no runs match</div>}
        {BUCKET_ORDER.map((bucket) => {
          const bucketRuns = groups[bucket];
          if (!bucketRuns?.length) return null;
          return (
            <section key={bucket} className={`run-group run-group-${bucket}`}>
              <header className="run-group-head">
                <span className="run-group-label">{BUCKET_LABELS[bucket]}</span>
                <span className="run-group-count">{bucketRuns.length}</span>
              </header>
              <ol className="run-group-list">
                {bucketRuns.map((r) => (
                  <li
                    key={r.id}
                    className={`run-row ${selectedId === r.id ? "is-active" : ""}`}
                    onClick={() => onSelect(r.id)}
                  >
                    <div className="run-row-top">
                      <StatusPill status={r.status} />
                      <span className="run-time" title={r.startedAt}>{fmtRel(r.startedAt)}</span>
                    </div>
                    <div className="run-row-goal">{r.goal ?? "(no goal)"}</div>
                    <div className="run-row-meta">
                      {r.provider && <code>{r.provider}</code>}
                      {r.model && <code className="dim">{r.model}</code>}
                      <span className="sep">·</span>
                      <span className="dim">{r.eventCount} events</span>
                      {r.durationMs != null && (
                        <>
                          <span className="sep">·</span>
                          <span className="dim">{fmtDur(r.durationMs)}</span>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
