import React, { useEffect } from "react";
import Icon from "./Icons";
import { t } from "../i18n";

// Dialog backdrop: closes on outside click / Esc, locks page scroll while open.
export function Overlay({ children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && onClose) onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div data-testid="modal-overlay" className="tat-modal-overlay" onClick={onClose}>
      <div className="tat-modal-wrap" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ModalShell({ children, onClose, title, wide }) {
  return (
    <div className={`tat-modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
      <div className="tat-modal-head">
        <div className="tat-modal-title">{title}</div>
        <button type="button" className="tat-icon-btn" onClick={onClose} aria-label={t("إغلاق")}><Icon name="close" size={18} /></button>
      </div>
      <div className="tat-modal-body">{children}</div>
    </div>
  );
}

export function FieldLabel({ children }) {
  return <div className="tat-field-label">{children}</div>;
}
