"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api, duration, timeAgo, usePolling, type Member } from "@/lib/client";
import { PRESENCE_LABEL, type Position, type Presence } from "@/lib/constants";
import ActivityLog from "./ActivityLog";
import { Avatar, PositionBadge, PresenceBadge, Spinner, TelegramIcon } from "./ui";

interface Overview {
  me: string;
  bot: { online: boolean; lastSeenAt: string | null; startedAt: string | null; username: string | null };
  stats: {
    people: number;
    online: number;
    onBreak: number;
    offline: number;
    telegramLinked: number;
    noRole: number;
    open: number;
    inProgress: number;
    blocked: number;
    doneToday: number;
    overdue: number;
    teams: number;
    teamsConnected: number;
  };
  teams: {
    _id: string;
    name: string;
    color: string;
    connected: boolean;
    chatTitle: string | null;
    reportsEnabled: boolean;
    members: number;
    online: number;
    onBreak: number;
    open: number;
    inProgress: number;
    blocked: number;
    doneToday: number;
    overdue: number;
    lastActivityAt: string | null;
  }[];
  people: {
    _id: string;
    name: string;
    email: string;
    role: "admin" | "member";
    position: Position | null;
    presence: Presence;
    presenceNote: string | null;
    presenceSince: string;
    lastSeenAt: string | null;
    telegram: string | null;
    teams: string[];
    open: number;
    createdAt: string;
  }[];
  blocked: { _id: string; name: string; email: string | null; telegram: string | null; createdAt: string }[];
}

type Person = Overview["people"][number];

const POLL_MS = 10_000;

export default function AdminDashboard() {
  const { data, error, reload } = usePolling<Overview>("/api/admin/overview", POLL_MS);
  const [search, setSearch] = useState("");
  const [presence, setPresence] = useState<Presence | "">("");
  const [removing, setRemoving] = useState<Person | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function signInAs(p: Person) {
    if (!confirm(`Sign in as ${p.name}? You'll see TaskTrack exactly as they do, and anything you do counts as them. Use "Back to admin" at the top to return (or it ends after 1 hour).`)) return;
    try {
      await api("/api/admin/impersonate", { method: "POST", json: { userId: p._id } });
      window.location.href = "/tracker";
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function unblock(b: Overview["blocked"][number]) {
    if (!confirm(`Unblock ${b.name}? They'll be able to sign up and join the Telegram groups again.`)) return;
    try {
      await api(`/api/admin/blocked/${b._id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.people ?? []).filter(
      (p) =>
        (!presence || p.presence === presence) &&
        (!q || `${p.name} ${p.email} ${p.teams.join(" ")} ${p.telegram ?? ""}`.toLowerCase().includes(q)),
    );
  }, [data?.people, search, presence]);

  // ActivityLog only needs id + name for its person filter.
  const feedMembers = useMemo(
    () => (data?.people ?? []).map((p) => ({ _id: p._id, name: p.name }) as Member),
    [data?.people],
  );

  if (!data) {
    return (
      <div className="flex justify-center py-24 text-muted">
        {error ? <p>{error}</p> : <Spinner className="h-6 w-6" />}
      </div>
    );
  }
  const s = data.stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-0.5 text-sm text-muted">Everything at a glance · refreshes every {POLL_MS / 1000}s</p>
        </div>
        <BotPill bot={data.bot} />
      </div>

      {notice && (
        <p role="status" className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm">
          {notice}
          <button className="text-xs text-muted hover:text-fg" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </p>
      )}

      {/* KPIs — numbers in ink; a small dot carries the meaning */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="People" value={s.people} sub={`${s.telegramLinked} on Telegram`} />
        <Kpi label="Online" value={s.online} dot="bg-online" />
        <Kpi label="On break" value={s.onBreak} dot="bg-break" />
        <Kpi label="Offline" value={s.offline} dot="bg-offline" />
        <Kpi label="Open tickets" value={s.open} sub={`${s.inProgress} in progress`} dot="bg-accent" />
        <Kpi label="Blocked" value={s.blocked} dot="bg-danger" />
        <Kpi label="Done today" value={s.doneToday} dot="bg-online" />
        <Kpi label="Overdue" value={s.overdue} dot="bg-danger" />
      </div>

      {(s.noRole > 0 || s.teams === 0 || s.teamsConnected < s.teams || !data.bot.online) && (
        <ul className="space-y-1.5 rounded-xl border border-break/40 bg-break/10 px-4 py-3 text-sm">
          {!data.bot.online && (
            <li>
              ⚠️ The Telegram bot isn't running{data.bot.lastSeenAt ? ` (last seen ${timeAgo(data.bot.lastSeenAt)})` : ""} — start it with <code className="rounded bg-surface px-1">npm run bot:dev</code>.
            </li>
          )}
          {s.teams === 0 && (
            <li>
              👥 No teams yet —{" "}
              <Link href="/team" className="font-medium text-accent hover:underline">
                create one
              </Link>{" "}
              and connect its Telegram group.
            </li>
          )}
          {s.teams > 0 && s.teamsConnected < s.teams && (
            <li>
              🔌 {s.teams - s.teamsConnected} team{s.teams - s.teamsConnected === 1 ? "" : "s"} without a connected Telegram group.
            </li>
          )}
          {s.noRole > 0 && (
            <li>
              🏷️ {s.noRole} {s.noRole === 1 ? "person has" : "people have"} no role —{" "}
              <Link href="/team?tab=people" className="font-medium text-accent hover:underline">
                assign roles
              </Link>
              .
            </li>
          )}
        </ul>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {/* Teams */}
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-semibold">
                Teams <span className="font-normal text-muted">{s.teams}</span>
              </h2>
              <Link href="/team" className="text-xs font-medium text-accent hover:underline">
                Manage →
              </Link>
            </div>
            {data.teams.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] tracking-wide text-muted uppercase">
                      <th className="px-4 py-2 font-medium">Team</th>
                      <th className="px-3 py-2 font-medium">Telegram</th>
                      <th className="px-3 py-2 text-right font-medium">Online</th>
                      <th className="px-3 py-2 text-right font-medium">Open</th>
                      <th className="px-3 py-2 text-right font-medium">Blocked</th>
                      <th className="px-3 py-2 text-right font-medium">Overdue</th>
                      <th className="px-3 py-2 text-right font-medium">Done today</th>
                      <th className="px-4 py-2 text-right font-medium">Last activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.teams.map((t) => (
                      <tr key={t._id} className="hover:bg-surface-2/50">
                        <td className="px-4 py-2.5">
                          <Link href={`/tracker?team=${t._id}`} className="flex items-center gap-2 font-medium hover:text-accent">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                            {t.name}
                            <span className="text-xs font-normal text-muted">{t.members} people</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {t.connected ? (
                            <span className="flex items-center gap-1.5" title={t.reportsEnabled ? "EOD/EOW posts on" : "EOD/EOW posts off"}>
                              <TelegramIcon className="h-3.5 w-3.5 text-accent" />
                              <span className="max-w-36 truncate">{t.chatTitle ?? "Connected"}</span>
                            </span>
                          ) : (
                            <span className="text-muted">Not connected</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {t.online}
                          <span className="text-muted">/{t.members}</span>
                          {t.onBreak > 0 && <span className="ml-1 text-xs text-muted">({t.onBreak} break)</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{t.open}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{t.blocked ? <span className="font-semibold">{t.blocked} ⛔</span> : 0}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{t.overdue ? <span className="font-semibold">{t.overdue} ⚠️</span> : 0}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{t.doneToday}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-muted">{t.lastActivityAt ? timeAgo(t.lastActivityAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted">No teams yet.</p>
            )}
          </section>

          {/* People */}
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="mr-auto font-semibold">
                People <span className="font-normal text-muted">{people.length}</span>
              </h2>
              <input className="input w-full py-1.5 sm:w-56" placeholder="Search name, email, team…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
              <select className="input w-auto py-1.5" value={presence} onChange={(e) => setPresence(e.target.value as Presence | "")} aria-label="Status">
                <option value="">Any status</option>
                {(["online", "break", "offline"] as Presence[]).map((p) => (
                  <option key={p} value={p}>
                    {PRESENCE_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            {people.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] tracking-wide text-muted uppercase">
                      <th className="px-4 py-2 font-medium">Person</th>
                      <th className="px-3 py-2 font-medium">Role</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Teams</th>
                      <th className="px-3 py-2 font-medium">Telegram</th>
                      <th className="px-3 py-2 text-right font-medium">Open</th>
                      <th className="px-3 py-2 text-right font-medium">Last seen</th>
                      <th className="px-4 py-2" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {people.map((p) => (
                      <tr key={p._id} className="hover:bg-surface-2/50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={p.name} id={p._id} size={28} presence={p.presence} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{p.name}</p>
                              <p className="truncate text-xs text-muted">{p.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <PositionBadge position={p.position} admin={p.role === "admin"} size="xs" />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-start gap-0.5">
                            <PresenceBadge presence={p.presence} />
                            <span className="text-[11px] text-muted">
                              {duration(p.presenceSince)}
                              {p.presenceNote ? ` · “${p.presenceNote}”` : ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs">{p.teams.length ? p.teams.join(", ") : <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2.5 text-xs">{p.telegram ?? <span className="text-muted">Not linked</span>}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{p.open}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-muted">{timeAgo(p.lastSeenAt)}</td>
                        <td className="px-4 py-2.5 text-right">
                          {p._id !== data.me && (
                            <div className="flex justify-end gap-1">
                              {p.role !== "admin" && (
                                <button className="rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap text-accent hover:bg-accent-soft" onClick={() => signInAs(p)}>
                                  Log in as
                                </button>
                              )}
                              <button className="rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10" onClick={() => setRemoving(p)}>
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted">{data.people.length ? "Nobody matches." : "No one has signed up yet."}</p>
            )}
          </section>

          {data.blocked.length > 0 && (
            <section className="card overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <h2 className="font-semibold">
                  Blocked <span className="font-normal text-muted">{data.blocked.length}</span>
                </h2>
                <p className="text-xs text-muted">Can't sign up, sign in with Google, or link Telegram.</p>
              </div>
              <ul className="divide-y divide-line">
                {data.blocked.map((b) => (
                  <li key={b._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="mr-auto min-w-0">
                      <p className="truncate font-medium">{b.name}</p>
                      <p className="truncate text-xs text-muted">
                        {[b.email, b.telegram].filter(Boolean).join(" · ")} · blocked {timeAgo(b.createdAt)}
                      </p>
                    </div>
                    <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => unblock(b)}>
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <ActivityLog members={feedMembers} viewAllHref="/activity" title="Live activity" className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]" />
      </div>

      {removing && (
        <DeleteUserDialog
          person={removing}
          onClose={() => setRemoving(null)}
          onDone={(msg) => {
            setRemoving(null);
            setNotice(msg);
            reload();
          }}
        />
      )}
    </div>
  );
}

function DeleteUserDialog({ person, onClose, onDone }: { person: Person; onClose: () => void; onDone: (message: string) => void }) {
  const [block, setBlock] = useState(true);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = typed.trim().toLowerCase() === person.name.trim().toLowerCase();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ name: string; blocked: boolean; bannedFrom: string[] }>(`/api/admin/users/${person._id}${block ? "?block=1" : ""}`, {
        method: "DELETE",
      });
      onDone(
        `${res.name} was deleted${res.blocked ? " and blocked" : ""}.` +
          (res.bannedFrom.length ? ` Removed from Telegram: ${res.bannedFrom.join(", ")}.` : ""),
      );
    } catch (error) {
      setErr((error as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
        className="card w-full max-w-md space-y-4 p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div>
          <h2 id="delete-user-title" className="text-lg font-semibold">
            Delete {person.name}?
          </h2>
          <p className="mt-1 text-sm text-muted">
            They&apos;re signed out straight away and removed from every team. Their tickets stay, unassigned, and past activity is kept. This can&apos;t be undone.
          </p>
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5" checked={block} onChange={(e) => setBlock(e.target.checked)} />
          <span>
            <span className="font-medium">Block them too</span>
            <span className="block text-xs text-muted">
              {person.email}
              {person.telegram ? ` and Telegram ${person.telegram}` : ""} can&apos;t sign up or link again
              {person.telegram ? "; the bot also removes them from the teams' Telegram groups (it must be a group admin)" : ""}.
            </span>
          </span>
        </label>
        <label className="block text-sm">
          Type <span className="font-semibold">{person.name}</span> to confirm
          <input className="input mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
        </label>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="rounded-lg bg-danger px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!ok || busy}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Kpi({ label, value, sub, dot }: { label: string; value: number; sub?: string; dot?: string }) {
  return (
    <div className="card px-3.5 py-3">
      <p className="flex items-center gap-1.5 truncate text-xs text-muted">
        {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />}
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="truncate text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function BotPill({ bot }: { bot: Overview["bot"] }) {
  return (
    <span
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${bot.online ? "border-online/40 bg-online/10" : "border-danger/40 bg-danger/10"}`}
      title={bot.startedAt ? `Running since ${new Date(bot.startedAt).toLocaleString()}` : undefined}
    >
      <span className="relative flex h-2 w-2">
        {bot.online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-online opacity-60" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${bot.online ? "bg-online" : "bg-danger"}`} />
      </span>
      <TelegramIcon className="h-3.5 w-3.5" />
      {bot.online ? `Bot running${bot.username ? ` · @${bot.username}` : ""}` : "Bot offline"}
      {bot.lastSeenAt && <span className="text-xs text-muted">· {timeAgo(bot.lastSeenAt)}</span>}
    </span>
  );
}
