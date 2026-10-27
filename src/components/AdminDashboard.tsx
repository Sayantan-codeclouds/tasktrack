"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { duration, timeAgo, usePolling, type Member } from "@/lib/client";
import { PRESENCE_LABEL, type Position, type Presence } from "@/lib/constants";
import ActivityLog from "./ActivityLog";
import { Avatar, PositionBadge, PresenceBadge, Spinner, TelegramIcon } from "./ui";

interface Overview {
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
}

const POLL_MS = 10_000;

export default function AdminDashboard() {
  const { data, error } = usePolling<Overview>("/api/admin/overview", POLL_MS);
  const [search, setSearch] = useState("");
  const [presence, setPresence] = useState<Presence | "">("");

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
                      <th className="px-4 py-2 text-right font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {people.map((p) => (
                      <tr key={p._id} className="hover:bg-surface-2/50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={p.name} size={28} presence={p.presence} />
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
                        <td className="px-4 py-2.5 text-right text-xs text-muted">{timeAgo(p.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted">{data.people.length ? "Nobody matches." : "No one has signed up yet."}</p>
            )}
          </section>
        </div>

        <ActivityLog members={feedMembers} viewAllHref="/activity" title="Live activity" className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)]" />
      </div>
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
