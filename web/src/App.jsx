import { useEffect, useMemo, useState } from "react";

import { Header } from "./components/Header.jsx";
import { Inspector } from "./components/Inspector.jsx";
import { RunDetail } from "./components/RunDetail.jsx";
import { RunsList } from "./components/RunsList.jsx";
import { SlideOver } from "./components/SlideOver.jsx";
import { StatusBar } from "./components/StatusBar.jsx";
import { StatusStrip } from "./components/StatusStrip.jsx";
import { TaskComposer } from "./components/TaskComposer.jsx";
import { useRuns } from "./hooks/useRuns.js";
import { useTheme } from "./hooks/useTheme.js";
import { useWorkerHealth } from "./hooks/useWorkerHealth.js";
import { fetchHealth } from "./lib/api.js";
import { adaptRun, adaptRuns } from "./lib/adapt.js";

export function App() {
  const [selectedId, setSelectedId] = useState(null);
  const [pickedEvent, setPickedEvent] = useState(null);
  const [tailing, setTailing] = useState(true);
  const [filters, setFilters] = useState({ status: "all", provider: "all", q: "" });
  const [logPath, setLogPath] = useState(null);
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const { theme, toggle: onToggleTheme } = useTheme();
  const { health: workerHealth } = useWorkerHealth();

  const openLauncher = () => {
    setLauncherOpen(true);
    setComposerFocusKey((k) => k + 1);
  };

  useEffect(() => {
    function onKey(event) {
      const target = event.target;
      const inField =
        target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setLauncherOpen((v) => !v);
        if (!launcherOpen) setComposerFocusKey((k) => k + 1);
      } else if (!inField && event.key === "n" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        openLauncher();
      } else if (!inField && event.key === "i" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setInspectorOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [launcherOpen]);

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
        onNewTask={openLauncher}
        theme={theme}
        onToggleTheme={onToggleTheme}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
      />
      <StatusStrip
        runs={runs}
        workerHealth={workerHealth}
        onFocusBucket={(bucket) => {
          setFilters((f) => ({
            ...f,
            status: bucket === "active" ? "running" : bucket === "needs-you" ? "blocked" : "all",
          }));
        }}
      />
      <main className={`grid${inspectorOpen ? "" : " no-insp"}`}>
        <RunsList
          runs={runs}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filters={filters}
          setFilters={setFilters}
        />
        <RunDetail
          run={selected}
          onPickEvent={(ev) => {
            setPickedEvent(ev);
            if (!inspectorOpen) setInspectorOpen(true);
          }}
          pickedEvent={pickedEvent}
        />
        {inspectorOpen && <Inspector run={selected} event={pickedEvent} />}
      </main>
      <StatusBar runs={runs} logPath={logPath} tailing={tailing} />
      <SlideOver
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        title="New task"
      >
        <TaskComposer
          focusKey={composerFocusKey}
          workerHealth={workerHealth}
          onCreated={(run) => {
            if (run?.runId) {
              setSelectedId(run.runId);
            }
            setTailing(true);
            setLauncherOpen(false);
          }}
          onCancel={() => setLauncherOpen(false)}
        />
      </SlideOver>
    </div>
  );
}
