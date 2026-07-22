// Shared modal chrome — the backdrop + panel + head/body/foot that every
// author dialog repeated. Each modal now supplies just a title, a footer
// (its action buttons), and its body content.
//
// `busy` (an operation in flight) disables the backdrop-click-to-close and
// hides the ✕ so a half-finished action can't be dismissed underneath.

import { type ReactNode } from "react";

interface ModalProps {
  /** Head text/label. */
  title: ReactNode;
  onClose: () => void;
  /** While true, the modal can't be dismissed (backdrop + ✕ inert). */
  busy?: boolean;
  /** Foot content — usually the Cancel / primary-action buttons. */
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, onClose, busy = false, footer, children }: ModalProps) {
  return (
    <div className="author-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="author-modal" onClick={(e) => e.stopPropagation()}>
        <div className="author-modal-head">
          <span>{title}</span>
          {!busy && <button type="button" className="author-mini-btn" onClick={onClose}>✕</button>}
        </div>
        <div className="author-modal-body">{children}</div>
        {footer && <div className="author-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
