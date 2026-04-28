import { fmtDur, fmtRel } from "../lib/format.js";
import { FilterChips } from "./FilterChips.jsx";
import { StatusPill } from "./StatusPill.jsx";

export function RunsList({ runs, selectedId, onSelect, filters, setFilters }) {
  const filtered = runs.filter((r) => {
    if (filters.status !== "all" && r.status !== filters.status) return false;
    if (filters.provider !== "all" && r.provider !== filters.provider) return false;
    if (filters.q && !r.goal?.toLowerCase().includes(filters.q.toLowerCase())) return false;
    return true;
  });
  const providers = Array.from(new Set(runs.map((r) => r.provider).filter(Boolean)));

  return (
    <aside className="runs">
      <div className="runs-toolbar">
        <input
          className="search"
          placeholder="filter goals…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
        />
        <div className="filter-row">
          <FilterChips
            label="status"
            value={filters.status}
            options={["all", "done", "blocked", "running"]}
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
        <span className="dim">grouped by taskId</span>
      </div>
      <ol className="runs-list">
        {filtered.map((r) => (
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
        {filtered.length === 0 && <li className="empty">no runs match</li>}
      </ol>
    </aside>
  );
}
