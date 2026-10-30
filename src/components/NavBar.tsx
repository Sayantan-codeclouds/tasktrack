"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, emitRefresh } from "@/lib/client";
import { PRESENCE, PRESENCE_LABEL, type Presence } from "@/lib/constants";
import { Avatar, TelegramIcon } from "./ui";

interface Props {
  user: { _id: string; name: string; presence: Presence; presenceNote: string | null; telegramLinked: boolean };
  /** Team Leads (of a team) and Managers. */
  showReports?: boolean;
  /** Team Leads and Managers. */
  showTeam?: boolean;
  isAdmin?: boolean;
  /** The admin is signed in as this person ("Admin view"). */
  viewingAs?: boolean;
  /** Their teams' meeting links. */
  meetings?: { team: string; url: string }[];
}

const LINKS = [
  { href: "/tracker", label: "Tracker" },
  { href: "/eod", label: "EOD / EOW" },
  { href: "/reports", label: "Reports", reports: true },
  { href: "/team", label: "Team", team: true },
  { href: "/activity", label: "Activity" },
  { href: "/profile", label: "Profile" },
  { href: "/admin", label: "Overview", admin: true },
];

export default function NavBar({ user, showReports = false, showTeam = false, isAdmin = false, viewingAs = false, meetings = [] }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [presence, setPresence] = useState(user.presence);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPresence(user.presence), [user.presence]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function changePresence(p: Presence) {
    setOpen(false);
    setPresence(p);
    try {
      await api("/api/me/presence", { method: "PATCH", json: { presence: p } });
      emitRefresh();
      router.refresh();
    } catch {
      setPresence(user.presence);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.replace(isAdmin ? "/admin/login" : "/login");
    router.refresh();
  }

  const dot: Record<Presence, string> = { online: "bg-online", break: "bg-break", offline: "bg-offline" };

  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-surface/75 backdrop-blur-xl backdrop-saturate-150">
      {viewingAs && <AdminViewBar name={user.name} />}
      <div className="mx-auto flex h-15 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/tracker" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-linear-to-br from-accent to-accent-2 text-white shadow-md shadow-accent/30">
            <TelegramIcon className="h-4 w-4" />
          </span>
          <span className="hidden sm:inline">TaskTrack</span>
        </Link>

        <nav className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto px-1 sm:gap-1" aria-label="Main">
          {LINKS.filter((l) => (!l.reports || showReports) && (!l.team || showTeam) && (!l.admin || isAdmin)).map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${
                  active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2" ref={menuRef}>
          <MeetingButton meetings={meetings} />
          {!user.telegramLinked && (
            <Link
              href="/profile"
              className="hidden items-center gap-1.5 rounded-lg bg-break/15 px-2.5 py-1 text-xs font-medium text-break md:inline-flex"
            >
              <TelegramIcon className="h-3.5 w-3.5" /> Link Telegram
            </Link>
          )}
          <div className="relative">
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-sm hover:bg-surface-2"
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <Avatar name={user.name} id={user._id} size={26} presence={presence} />
              <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
              <svg viewBox="0 0 20 20" className="h-4 w-4 text-muted" fill="currentColor" aria-hidden>
                <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
            {open && (
              <div role="menu" className="card absolute right-0 mt-2 w-48 overflow-hidden p-1 shadow-lg">
                <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Set status</p>
                {PRESENCE.map((p) => (
                  <button
                    key={p}
                    role="menuitem"
                    onClick={() => changePresence(p)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    <span className={`h-2 w-2 rounded-full ${dot[p]}`} />
                    {PRESENCE_LABEL[p]}
                    {p === presence && <span className="ml-auto text-accent">✓</span>}
                  </button>
                ))}
                <div className="my-1 border-t border-line" />
                <button
                  role="menuitem"
                  onClick={logout}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-surface-2"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/** Opens the team's meeting. Someone in several teams with links picks one. */
function MeetingButton({ meetings }: { meetings: { team: string; url: string }[] }) {
  const cls = "inline-flex items-center gap-1.5 rounded-lg bg-online/15 px-2.5 py-1 text-xs font-medium text-online hover:bg-online/25";
  if (!meetings.length) return null;
  if (meetings.length === 1) {
    return (
      <a href={meetings[0].url} target="_blank" rel="noopener noreferrer" className={cls} title={`${meetings[0].team} meeting`}>
        <span aria-hidden>📹</span> <span className="hidden sm:inline">Meeting</span>
      </a>
    );
  }
  return (
    <details className="relative">
      <summary className={`${cls} cursor-pointer list-none`}>
        <span aria-hidden>📹</span> <span className="hidden sm:inline">Meetings</span>
      </summary>
      <div className="card absolute right-0 z-40 mt-2 w-48 overflow-hidden p-1 shadow-lg">
        {meetings.map((m) => (
          <a key={m.url + m.team} href={m.url} target="_blank" rel="noopener noreferrer" className="block truncate rounded-md px-3 py-2 text-sm hover:bg-surface-2">
            {m.team}
          </a>
        ))}
      </div>
    </details>
  );
}

/** Shown while the admin is signed in as someone else. */
function AdminViewBar({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  async function back() {
    setBusy(true);
    try {
      await api("/api/admin/impersonate", { method: "DELETE" });
      window.location.href = "/admin";
    } catch {
      // The admin view expired (1 hour) — sign in again.
      window.location.href = "/login";
    }
  }
  return (
    <div className="bg-break text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-sm sm:px-6">
        <span aria-hidden>👁</span>
        <span className="mr-auto">
          <strong>Admin view</strong> — you&apos;re signed in as {name}. Anything you do counts as them. Ends after 1 hour.
        </span>
        <button onClick={back} disabled={busy} className="rounded-md bg-white/20 px-2.5 py-0.5 text-xs font-semibold hover:bg-white/30 disabled:opacity-60">
          {busy ? "Returning…" : "Back to admin"}
        </button>
      </div>
    </div>
  );
}
