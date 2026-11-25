import { useEffect, type ReactNode } from "react";
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className={`badge ${String(children).replaceAll(" ", "-")}`}>
      {children}
    </span>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">⚑</span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  useEffect(() => {
    const el = document.activeElement as HTMLElement;
    document.querySelector("dialog")?.showModal();
    return () => el?.focus();
  }, []);
  return (
    <dialog onCancel={close}>
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={close} aria-label="Cerrar">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export const modes: Record<string, string> = {
  vueltas: "Carrera por vueltas",
  contrarreloj: "Contrarreloj",
  eliminación: "Eliminación",
  resistencia: "Resistencia",
};
export function RunningFigure() {
  return (
    <svg
      className="running-figure"
      viewBox="0 0 100 120"
      aria-hidden="true"
      fill="none"
    >
      <circle cx="63" cy="16" r="9" fill="currentColor" />
      <path
        d="M57 35 43 55 62 71 77 105M44 54 29 80 8 84M55 38 74 49 91 43M53 38 32 34 19 47"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
