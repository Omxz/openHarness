import { useEffect, useMemo, useState } from "react";

import { Header } from "./components/Header.jsx";
import { Inspector } from "./components/Inspector.jsx";
import { RunDetail } from "./components/RunDetail.jsx";
import { RunsList } from "./components/RunsList.jsx";
import { StatusBar } from "./components/StatusBar.jsx";
import { TaskComposer } from "./components/TaskComposer.jsx";
import { useRuns } from "./hooks/useRuns.js";
import { fetchHealth } from "./lib/api.js";
import { adaptRun, adaptRuns } from "./lib/adapt.js";

export function App() {
  const [selectedId, setSelectedId] = useState(null);
  const [pickedEvent, setPickedEvent] = useState(null);
  const [tailing, setTailing] = useState(true);
  const [filters, setFilters] = useState({ status: "all", provider: "all", q: "" });
  const [logPath, setLogPath] = useState(null);
  const [composerFocusKey, setComposerFocusKey] = useState(0);

  useEffect(() => {
    fetchHealth().then((h) => setLogPath(h.logPath)).catch(() => {});
  }, []);

  const { runs: rawRuns, selected: rawSelected } = useRuns({ selectedId, tailing });

  const runs = useMemo(() => adaptRuns(rawRuns), [rawRuns]);
  const selected = useMemo(() => adaptRun(rawSelected), [rawSelected]);

  useEffect(() => {
    if (selectedId) return;
    if (runs.length > 0) setSelectedId(runs[0].id);
  }, [runs, selectedId]);

  useEffect(() => {
    setPickedEvent(null);
  }, [selectedId]);

  return (
    <div className="app">
      <Header
        runs={runs}
        autoRefresh={tailing}
        setAutoRefresh={setTailing}
        logPath={logPath}
        onNewTask={() => setComposerFocusKey((key) => key + 1)}
      />
      <TaskComposer
        focusKey={composerFocusKey}
        onCreated={(run) => {
          if (run?.runId) {
            setSelectedId(run.runId);
          }
          setTailing(true);
        }}
      />
      <main className="grid">
        <RunsList
          runs={runs}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filters={filters}
          setFilters={setFilters}
        />
        <RunDetail
          run={selected}
          onPickEvent={setPickedEvent}
          pickedEvent={pickedEvent}
        />
        <Inspector run={selected} event={pickedEvent} />
      </main>
      <StatusBar runs={runs} logPath={logPath} tailing={tailing} />
    </div>
  );
}
