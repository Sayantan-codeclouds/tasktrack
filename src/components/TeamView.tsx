"use client";

import { useMemo, useState } from "react";
import { api, duration, emitRefresh, timeAgo, usePolling } from "@/lib/client";
import {
  POSITION_GROUP,
  POSITION_LABEL,
  POSITION_RANK,
  PRESENCE_LABEL,
  type Position,
  type Presence,
} from "@/lib/constants";
import { Avatar, PositionBadge, Spinner, TelegramIcon } from "./ui";

interface TeamMember {
  _id: string;
  name: string;
  email?: string;
  role: "admin" | "member";
  position: Position | null;
  presence: Presence;
  presenceNote: string | null;
  presenceSince: string;
  lastSeenAt: string | null;
  telegramUsername: string | null;
  telegramId: string | null;
  createdAt: string;
  open: number;
  done: number;
  canEditRole: boolean;
  requestedPosition: Position | null;
  canApprove: boolean;
}

interface TeamData {
  me: { _id: string; role: "admin" | "member"; position: Position | null; canAssignRoles: boolean; assignable: Position[] };
  members: TeamMember[];
}

type Group = "management" | "lead" | "development" | "design" | "none";
const GROUPS: { id: Group; label: string; hint: string }[] = [
  { id: "management", label: "Management", hint: "Senior Managers & Managers" },
  { id: "lead", label: "Team Leads", hint: "Can edit and move any ticket" },
  { id: "development", label: "Developers", hint: "Senior & Junior" },
  { id: "design", label: "Designers", hint: "Senior & Junior" },
  { id: "none", label: "No role yet", hint: "Waiting for a manager to assign one" },
];
const groupOf = (p: Position | null): Group => (p ? POSITION_GROUP[p] : "none");
const presenceTone: Record<Presence, string> = { online: "text-online", break: "text-break", offline: "text-offline" };

export default function TeamView() {
  const { data, error, reload } = usePolling<TeamData>("/api/team", 15000);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<Group | "">("");

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = new Map<Group, TeamMember[]>(GROUPS.map((g) => [g.id, []]));
    for (const m of data?.members ?? []) {
      const label = m.position ? POSITION_LABEL[m.position] : "";
      if (q && !`${m.name} ${label} ${m.email ?? ""} ${m.telegramUsername ?? ""}`.toLowerCase().includes(q)) continue;
      out.get(groupOf(m.position))!.push(m);
    }
    for (const list of out.values()) {
      list.sort(
        (a, b) =>
          (b.position ? POSITION_RANK[b.position] : 0) - (a.position ? POSITION_RANK[a.position] : 0) ||
          a.name.localeCompare(b.name),
      );
    }
    return out;
  }, [data?.members, search]);

  if (!data) {
    return (
      <div className="flex justify-center py-24 text-muted">
        {error ? <p>{error}</p> : <Spinner className="h-6 w-6" />}
      </div>
    );
  }

  const counts = Object.fromEntries(GROUPS.map((g) => [g.id, data.members.filter((m) => groupOf(m.position) === g.id).length])) as Record<Group, number>;
  const unassigned = counts.none;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted">
          {data.members.length} people ·{" "}
          {data.me.canAssignRoles ? "You can assign roles below your own." : "Roles are assigned by Managers and above."}
        </p>
        <div className="relative w-full sm:w-64">
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.5 13.5 3 3" strokeLinecap="round" />
          </svg>
          <input className="input pl-8" placeholder="Search name, role, email…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search team" />
        </div>
      </div>

      <RoleRequests members={data.members} onChanged={reload} />

      {/* Group filter cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroup((cur) => (cur === g.id ? "" : g.id))}
            aria-pressed={group === g.id}
            className={`card p-3.5 text-left transition hover:border-accent/50 ${group === g.id ? "border-accent ring-2 ring-accent/20" : ""}`}
          >
            <p className="text-2xl font-semibold tabular-nums">{counts[g.id]}</p>
            <p className="truncate text-xs text-muted">{g.label}</p>
          </button>
        ))}
      </div>

      {data.me.canAssignRoles && unassigned > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-break/40 bg-break/10 px-4 py-3 text-sm">
          <span className="text-lg" aria-hidden>👋</span>
          <span className="flex-1">
            <strong>{unassigned}</strong> {unassigned === 1 ? "person doesn't" : "people don't"} have a role yet. Pick one from the dropdown on their card.
          </span>
          {group !== "none" && (
            <button className="text-xs font-medium text-accent hover:underline" onClick={() => setGroup("none")}>
              Show them
            </button>
          )}
        </div>
      )}

      {GROUPS.filter((g) => !group || g.id === group).map((g) => {
        const list = grouped.get(g.id)!;
        if (!list.length) return null;
        return (
          <section key={g.id}>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="font-semibold">{g.label}</h2>
              <span className="text-xs text-muted">
                {list.length} · {g.hint}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((m) => (
                <MemberCard key={m._id} member={m} me={data.me} onChanged={reload} />
              ))}
            </div>
          </section>
        );
      })}

      {[...grouped.values()].every((l) => !l.length) && <p className="py-12 text-center text-sm text-muted">Nobody matches “{search}”.</p>}
    </div>
  );
}

/** People who asked for a leadership role at sign-up. */
function RoleRequests({ members, onChanged }: { members: TeamMember[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requests = members.filter((m) => m.requestedPosition);
  if (!requests.length) return null;

  async function decide(m: TeamMember, approve: boolean) {
    setBusy(m._id);
    setError(null);
    try {
      await api(`/api/team/${m._id}`, { method: "PATCH", json: approve ? { position: m.requestedPosition } : { declineRequest: true } });
      onChanged();
      emitRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card overflow-hidden border-accent/30">
      <div className="flex items-center gap-2 border-b border-line bg-accent-soft/50 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Role requests</h3>
        <span className="rounded-full bg-accent px-2 text-xs font-semibold text-white">{requests.length}</span>
        <span className="text-xs text-muted">Asked for at sign-up</span>
      </div>
      <ul className="divide-y divide-line">
        {requests.map((m) => (
          <li key={m._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar name={m.name} id={m._id} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.name}</p>
              <p className="text-xs text-muted">
                Wants to be <strong className="text-fg">{POSITION_LABEL[m.requestedPosition!]}</strong>
                {m.position ? ` · currently ${POSITION_LABEL[m.position]}` : " · no role yet"}
              </p>
            </div>
            {m.canApprove ? (
              <div className="flex gap-2">
                <button className="btn-ghost py-1.5 text-xs" disabled={busy === m._id} onClick={() => decide(m, false)}>
                  Decline
                </button>
                <button className="btn-primary py-1.5 text-xs" disabled={busy === m._id} onClick={() => decide(m, true)}>
                  {busy === m._id && <Spinner />} Approve
                </button>
              </div>
            ) : (
              <span className="text-xs text-muted">Needs someone more senior to approve</span>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="px-4 pb-3 text-xs text-danger">{error}</p>}
    </section>
  );
}

function MemberCard({ member: m, me, onChanged }: { member: TeamMember; me: TeamData["me"]; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMe = m._id === me._id;

  // Options: what I'm allowed to hand out, plus the current role so the select can display it.
  const options = useMemo(() => {
    const set = new Set<Position>(me.assignable);
    if (m.position) set.add(m.position);
    return [...set].sort((a, b) => POSITION_RANK[b] - POSITION_RANK[a]);
  }, [me.assignable, m.position]);

  async function change(value: string) {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/team/${m._id}`, { method: "PATCH", json: { position: value || null } });
      onChanged();
      emitRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`card flex flex-col p-4 ${isMe ? "ring-1 ring-accent/30" : ""}`}>
      <div className="flex items-start gap-3">
        <Avatar name={m.name} id={m._id} presence={m.presence} size={44} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-semibold">
            <span className="truncate">{m.name}</span>
            {isMe && <span className="text-xs font-normal text-muted">(you)</span>}
          </p>
          <div className="mt-1">
            <PositionBadge position={m.position} admin={m.role === "admin"} />
            {m.requestedPosition && (
              <p className="mt-1 text-[11px] text-muted">⏳ Asked to be {POSITION_LABEL[m.requestedPosition]} — waiting for approval</p>
            )}
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div className="col-span-2 flex items-center gap-1.5 truncate">
          <dt className="sr-only">Status</dt>
          <dd className="truncate">
            <span className={`font-medium ${presenceTone[m.presence]}`}>{PRESENCE_LABEL[m.presence]}</span>
            <span className="text-muted"> · {duration(m.presenceSince)}</span>
            {m.presenceNote && <span className="text-muted italic"> · “{m.presenceNote}”</span>}
          </dd>
        </div>
        {m.email && (
          <div className="col-span-2 truncate text-muted">
            <dt className="sr-only">Email</dt>
            <dd className="truncate">{m.email}</dd>
          </div>
        )}
        <div className="col-span-2 flex items-center gap-1.5 truncate text-muted">
          <dt className="sr-only">Telegram</dt>
          <TelegramIcon className={`h-3.5 w-3.5 shrink-0 ${m.telegramId ? "text-accent" : ""}`} />
          <dd className="truncate">
            {m.telegramId ? (m.telegramUsername ? `@${m.telegramUsername}` : "Linked") : "Not linked"}
            {m.telegramId && <> · seen {timeAgo(m.lastSeenAt)}</>}
          </dd>
        </div>
        <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
          <dt className="text-muted">Open tickets</dt>
          <dd className="text-base font-semibold tabular-nums">{m.open}</dd>
        </div>
        <div className="rounded-lg bg-surface-2 px-2.5 py-1.5">
          <dt className="text-muted">Completed</dt>
          <dd className="text-base font-semibold tabular-nums text-online">{m.done}</dd>
        </div>
      </dl>

      {m.canEditRole && (
        <div className="mt-4 border-t border-line pt-3">
          <label className="label" htmlFor={`role-${m._id}`}>
            Role
          </label>
          <div className="flex items-center gap-2">
            <select
              id={`role-${m._id}`}
              className="input py-1.5"
              value={m.position ?? ""}
              onChange={(e) => change(e.target.value)}
              disabled={saving}
            >
              <option value="">No role</option>
              {options.map((p) => (
                <option key={p} value={p} disabled={!me.assignable.includes(p)}>
                  {POSITION_LABEL[p]}
                </option>
              ))}
            </select>
            {saving && <Spinner className="h-4 w-4 shrink-0 text-muted" />}
          </div>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        </div>
      )}
    </article>
  );
}
