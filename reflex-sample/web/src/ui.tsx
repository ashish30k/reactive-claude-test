// Small presentational building blocks (Polaris-flavoured). No app logic here.
import { useEffect, type ReactNode } from "react";

export function Badge({ tone, children }: { tone?: "success" | "attention" | "critical" | "info" | "neutral"; children: ReactNode }) {
  return <span className={`badge badge-${tone ?? "neutral"}`}>{children}</span>;
}

export const fulfillmentTone = (label: string) => (label === "Fulfilled" ? "success" : label === "Unfulfilled" ? "attention" : "neutral");
export const paymentTone = (label: string) => (label === "Paid" ? "neutral" : label === "Pending" ? "attention" : label === "Refunded" ? "info" : "neutral");

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-header">
          {title && <h3>{title}</h3>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Banner({ tone = "critical", children, action }: { tone?: "critical" | "info"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role="alert">
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Toast({ message, onDismiss }: { message: string | null; onDismiss?: () => void }) {
  useEffect(() => {
    if (!message || !onDismiss) return;
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!message) return null;
  return (
    <div className="toast" role="status" onClick={onDismiss}>
      {message}
      {onDismiss && <span className="toast-x">×</span>}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon">⚠︎</div>
      <p>{message}</p>
      <button className="btn btn-primary" onClick={onRetry}>Try again</button>
    </div>
  );
}

export function Empty({ message }: { message: string | null }) {
  return (
    <div className="empty">
      <div className="empty-icon">✓</div>
      <p>{message}</p>
    </div>
  );
}

export function Thumb({ title, url }: { title: string; url: string | null }) {
  if (url) return <img className="thumb" src={url} alt="" />;
  const hue = [...title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <div className="thumb" style={{ background: `hsl(${hue} 45% 88%)`, color: `hsl(${hue} 45% 30%)` }}>
      {title.split(" ").slice(0, 2).map((w) => w[0]).join("")}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
