"use client";

import { useState } from "react";
import {
  POSITION_GROUP,
  POSITION_LABEL,
  PRESENCE_LABEL,
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  ticketKey,
  type Position,
  type Presence,
  type Priority,
  type Source,
  type TaskStatus,
} from "@/lib/constants";

const AVATAR_COLORS = ["#5c7cfa", "#20c997", "#f76707", "#be4bdb", "#1c7ed6", "#e64980", "#37b24d", "#fab005"];

export function Avatar({ name, size = 36, presence }: { name: string; size?: number; presence?: Presence }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
        style={{ background: color, fontSize: size * 0.38 }}
      >
        {initials}
      </span>
      {presence && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-surface ${presenceBg[presence]}`}
          style={{ width: size * 0.36, height: size * 0.36 }}
          title={PRESENCE_LABEL[presence]}
        />
      )}
    </span>
  );
}

const presenceBg: Record<Presence, string> = {
  online: "bg-online",
  break: "bg-break",
  offline: "bg-offline",
};

export function PresenceBadge({ presence }: { presence: Presence }) {
  const styles: Record<Presence, string> = {
    online: "bg-online/15 text-online",
    break: "bg-break/15 text-break",
    offline: "bg-offline/15 text-offline",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${styles[presence]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${presenceBg[presence]}`} />
      {PRESENCE_LABEL[presence]}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const styles: Record<TaskStatus, string> = {
    todo: "bg-surface-2 text-muted",
    in_progress: "bg-accent-soft text-accent",
    blocked: "bg-danger/12 text-danger",
    done: "bg-online/15 text-online",
  };
  return (
    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

export function ProgressBar({ value, status }: { value: number; status?: TaskStatus }) {
  const color = status === "done" ? "bg-online" : status === "blocked" ? "bg-danger" : "bg-accent";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function SourceTag({ source }: { source: Source }) {
  const label = source === "telegram" ? "Telegram" : source === "web" ? "Web" : "System";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted" title={`via ${label}`}>
      {source === "telegram" ? <TelegramIcon className="h-3 w-3" /> : source === "web" ? <GlobeIcon className="h-3 w-3" /> : <ClockIcon className="h-3 w-3" />}
      {label}
    </span>
  );
}

export function TelegramIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9-8.1c.4-.3-.1-.5-.6-.2L6.3 13.1l-4.8-1.5c-1-.3-1-1 .2-1.5L20.5 3c.9-.3 1.6.2 1.4 1.3Z" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

const PRIORITY_STYLE: Record<Priority, { color: string; bars: number }> = {
  low: { color: "text-muted", bars: 1 },
  medium: { color: "text-accent", bars: 2 },
  high: { color: "text-break", bars: 3 },
  urgent: { color: "text-offline", bars: 3 },
};

/** Signal-bars style priority icon (urgent gets an exclamation mark). */
export function PriorityIcon({ priority: raw, withLabel = false }: { priority: Priority; withLabel?: boolean }) {
  const priority: Priority = PRIORITY_STYLE[raw] ? raw : "medium";
  const s = PRIORITY_STYLE[priority];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.color}`} title={`${PRIORITY_LABEL[priority]} priority`}>
      {priority === "urgent" ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <rect x="1" y="1" width="14" height="14" rx="3.5" />
          <path d="M8 4v5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="1" fill="white" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x={2 + i * 4.5}
              y={10 - i * 3.5}
              width="3"
              height={4 + i * 3.5}
              rx="1"
              fill="currentColor"
              opacity={i < s.bars ? 1 : 0.22}
            />
          ))}
        </svg>
      )}
      {withLabel && PRIORITY_LABEL[priority]}
    </span>
  );
}

const POSITION_TONE: Record<ReturnType<typeof groupOf>, string> = {
  management: "bg-[#7048e8]/12 text-[#7048e8] dark:text-[#b197fc]",
  lead: "bg-accent-soft text-accent",
  development: "bg-online/12 text-online",
  design: "bg-[#e64980]/12 text-[#d6336c] dark:text-[#f783ac]",
  none: "bg-surface-2 text-muted",
};
const groupOf = (p: Position | null | undefined) => (p ? POSITION_GROUP[p] : "none");

/** Job-role pill, e.g. "Senior Developer". */
export function PositionBadge({ position, admin = false, size = "sm" }: { position: Position | null | undefined; admin?: boolean; size?: "sm" | "xs" }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-md font-medium ${size === "xs" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-xs"} ${POSITION_TONE[groupOf(position)]}`}
      >
        {position ? POSITION_LABEL[position] : "No role"}
      </span>
      {admin && (
        <span className={`inline-flex rounded-md bg-fg font-medium text-bg ${size === "xs" ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-xs"}`}>
          Admin
        </span>
      )}
    </span>
  );
}

export function TicketKey({ number, className = "" }: { number: number | null; className?: string }) {
  if (!number) return null;
  return <span className={`font-mono text-[11px] font-semibold tracking-tight text-muted ${className}`}>{ticketKey(number)}</span>;
}

/** Password field with a show/hide toggle. */
export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={shown ? "text" : "password"} className={`input pr-10 ${props.className ?? ""}`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted hover:text-fg focus-visible:text-fg"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        tabIndex={0}
      >
        {shown ? (
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.6 7.9 3.1 9.8 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.5 4.4-1.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}
