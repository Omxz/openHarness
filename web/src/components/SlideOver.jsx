import { useEffect, useRef } from "react";

export function SlideOver({ open, onClose, title, children, width = 420, side = "right" }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    const previouslyFocused = document.activeElement;
    const focusTarget = dialogRef.current?.querySelector("textarea, input, select, button");
    focusTarget?.focus?.();
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="slide-over-root" data-open="true">
      <div className="slide-over-backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        className={`slide-over slide-over-${side}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ "--slide-over-width": `${width}px` }}
      >
        {title && (
          <header className="slide-over-head">
            <h2 className="slide-over-title">{title}</h2>
            <button
              type="button"
              className="slide-over-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </header>
        )}
        <div className="slide-over-body">{children}</div>
      </div>
    </div>
  );
}
