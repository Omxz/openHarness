import { eventKind, KIND_GLYPH, summarize } from "../lib/events.js";
import { fmtDur } from "../lib/format.js";

export function Timeline({ events, onPick, pickedTs }) {
  if (!events?.length) {
    return <div className="empty">no events</div>;
  }
  const t0 = new Date(events[0].timestamp).getTime();
  return (
    <ol className="tl">
      {events.map((ev, i) => {
        const kind = eventKind(ev);
        const dt = new Date(ev.timestamp).getTime() - t0;
        const isPicked = ev.timestamp === pickedTs;
        return (
          <li
            key={`${ev.timestamp}-${i}`}
            className={`tl-row tl-${kind} ${isPicked ? "is-picked" : ""}`}
            onClick={() => onPick(ev)}
          >
            <span className="tl-time" title={ev.timestamp}>+{fmtDur(dt)}</span>
            <span className="tl-glyph">{KIND_GLYPH[kind]}</span>
            <span className="tl-type">{ev.type}</span>
            <span className="tl-summary">{summarize(ev)}</span>
          </li>
        );
      })}
    </ol>
  );
}
