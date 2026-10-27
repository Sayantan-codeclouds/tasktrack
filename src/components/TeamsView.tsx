"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, emitRefresh, timeAgo, usePolling } from "@/lib/client";
import { POSITION_GROUP, POSITION_LABEL, POSITION_RANK, type Position, type Presence } from "@/lib/constants";
import { Avatar, Spinner, TelegramIcon } from "./ui";

interface TeamMemberRow {
  _id: string;
  name: string;
  position: Position | null;
  presence: Presence;
  telegramId: string | null;
  via: "telegram" | "web";
  addedAt: string;
}

interface TeamRow {
  _id: string;
  name: string;
  description: string | null;
  color: string;
  lead: { _id: string; name: string } | null;
  manager: { _id: string; name: string } | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  canManage: boolean;
  canChangeLead: boolean;
  canDelete: boolean;
  telegramLinked: boolean;
  telegramChatTitle: string | null;
  telegramLinkedAt: string | null;
  reportsEnabled: boolean;
  linkCode: string | null;
  linkCodeExpires: string | null;
  members: TeamMemberRow[];
  pending: { telegramId: string; username: string | null; name: string; joinedAt: string }[];
  open: number;
  done: number;
}

interface TeamsData {
  me: { _id: string; canCreate: boolean; canManage: boolean; isManager: boolean };
  users: { _id: string; name: string; position: Position | null }[];
  teams: TeamRow[];
}

const SECTIONS: { id: string; label: string; match: (p: Position | null) => boolean }[] = [
  { id: "management", label: "Management", match: (p) => !!p && POSITION_GROUP[p] === "management" },
  { id: "lead", label: "Team Lead", match: (p) => !!p && POSITION_GROUP[p] === "lead" },
  { id: "development", label: "Developers", match: (p) => !!p && POSITION_GROUP[p] === "development" },
  { id: "design", label: "Designers", match: (p) => !!p && POSITION_GROUP[p] === "design" },
  { id: "none", label: "No role yet", match: (p) => !p },
];

export default function TeamsView({ botUsername }: { botUsername: string | null }) {
  const [fast, setFast] = useState(false);
  const { data, error, reload } = usePolling<TeamsData>("/api/teams", fast ? 3000 : 15000);
  const [creating, setCreating] = useState(false);

  // Poll quickly while someone is waiting for a /link code to be used.
  useEffect(() => setFast(Boolean(data?.teams.some((t) => t.linkCode && !t.telegramLinked))), [data]);

  if (!data) {
    return (
      <div className="flex justify-center py-24 text-muted">
        {error ? <p>{error}</p> : <Spinner className="h-6 w-6" />}
      </div>
    );
  }

  const refresh = () => {
    reload();
    emitRefresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-muted">
          Each team has its own Telegram group. Add people to the group and they join the team here automatically.
        </p>
        {data.me.canCreate && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <span className="text-base leading-none">+</span> New team
          </button>
        )}
      </div>

      {creating && <CreateTeam data={data} onDone={() => (setCreating(false), refresh())} onCancel={() => setCreating(false)} />}

      {!data.teams.length ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <TelegramIcon className="h-6 w-6" />
          </span>
          <p className="font-semibold">No teams yet</p>
          <p className="max-w-md text-sm text-muted">
            {data.me.canCreate
              ? "Create a team (e.g. “POD5”), then connect its Telegram group. Everyone you add to that group shows up in the team."
              : "No teams yet — a Team Lead or Manager creates them."}
          </p>
          {data.me.canCreate && !creating && (
            <button className="btn-primary mt-1" onClick={() => setCreating(true)}>
              Create the first team
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {data.teams.map((t) => (
            <TeamCard key={t._id} team={t} data={data} botUsername={botUsername} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

const leadChoices = (users: TeamsData["users"]) => users.filter((u) => u.position && POSITION_RANK[u.position] >= POSITION_RANK.team_lead);
const managerChoices = (users: TeamsData["users"]) => users.filter((u) => u.position && POSITION_RANK[u.position] >= POSITION_RANK.manager);

function CreateTeam({ data, onDone, onCancel }: { data: TeamsData; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leadId, setLeadId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asManager = data.me.isManager;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/teams", {
        method: "POST",
        json: { name, description: description || null, leadId: leadId || null, managerId: managerId || null },
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">New team</h3>
        <p className="text-xs text-muted">{asManager ? "You'll oversee it — pick its Team Lead." : "You'll lead it — pick the Manager who oversees it."}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="team-name">Team name</label>
          <input id="team-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. POD5" required minLength={2} maxLength={40} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="team-desc">Description (optional)</label>
          <input id="team-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this team works on" maxLength={200} />
        </div>
        {asManager ? (
          <div>
            <label className="label" htmlFor="team-lead">Team Lead</label>
            <select id="team-lead" className="input" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Choose later</option>
              {leadChoices(data.users).map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name} — {POSITION_LABEL[u.position!]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="team-mgr">Overseeing Manager</label>
          <select id="team-mgr" className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">{asManager ? "Me" : "Choose later"}</option>
            {managerChoices(data.users)
              .filter((u) => u._id !== data.me._id)
              .map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name} — {POSITION_LABEL[u.position!]}
                </option>
              ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={busy}>
          {busy && <Spinner />} Create team
        </button>
      </div>
    </form>
  );
}

/** Lead / manager / shift — shown on every card, editable by whoever runs the team. */
function TeamSetup({ t, data, busy, run }: { t: TeamRow; data: TeamsData; busy: string | null; run: (key: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [start, setStart] = useState(t.shiftStart ?? "");
  const [end, setEnd] = useState(t.shiftEnd ?? "");
  useEffect(() => {
    setStart(t.shiftStart ?? "");
    setEnd(t.shiftEnd ?? "");
  }, [t.shiftStart, t.shiftEnd]);
  const isLead = t.lead?._id === data.me._id;
  const canSetManager = t.canManage && (data.me.isManager || isLead);
  const shiftDirty = (start || null) !== t.shiftStart || (end || null) !== t.shiftEnd;
  const patch = (key: string, json: Record<string, unknown>) => run(key, () => api(`/api/teams/${t._id}`, { method: "PATCH", json }));

  return (
    <div className="mt-4 grid gap-3 rounded-xl bg-surface-2/60 p-3.5 text-sm sm:grid-cols-3">
      <div>
        <p className="label mb-1">Team Lead</p>
        {t.canChangeLead ? (
          <select className="input py-1.5 text-xs" value={t.lead?._id ?? ""} disabled={busy === "lead"} onChange={(e) => patch("lead", { leadId: e.target.value || null })}>
            <option value="">— none —</option>
            {leadChoices(data.users).map((u) => (
              <option key={u._id} value={u._id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="flex items-center gap-2 font-medium">{t.lead ? <><Avatar name={t.lead.name} id={t.lead._id} size={20} /> {t.lead.name}</> : <span className="text-muted">Not set</span>}</p>
        )}
      </div>
      <div>
        <p className="label mb-1">Overseen by</p>
        {canSetManager ? (
          <select className="input py-1.5 text-xs" value={t.manager?._id ?? ""} disabled={busy === "manager"} onChange={(e) => patch("manager", { managerId: e.target.value || null })}>
            <option value="">— none —</option>
            {managerChoices(data.users).map((u) => (
              <option key={u._id} value={u._id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="flex items-center gap-2 font-medium">{t.manager ? <><Avatar name={t.manager.name} id={t.manager._id} size={20} /> {t.manager.name}</> : <span className="text-muted">Not set</span>}</p>
        )}
      </div>
      <div>
        <p className="label mb-1">Shift timings</p>
        {t.canManage ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              patch("shift", { shiftStart: start || null, shiftEnd: end || null });
            }}
          >
            <input type="time" className="input w-auto px-2 py-1.5 text-xs" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Shift start" />
            <span className="text-muted">–</span>
            <input type="time" className="input w-auto px-2 py-1.5 text-xs" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Shift end" />
            {shiftDirty && (
              <button className="btn-primary px-2.5 py-1.5 text-xs" disabled={busy === "shift"}>
                Save
              </button>
            )}
          </form>
        ) : (
          <p className="font-medium">{t.shiftStart && t.shiftEnd ? `🕘 ${t.shiftStart}–${t.shiftEnd}` : <span className="text-muted">Not set</span>}</p>
        )}
        {t.shiftEnd && <p className="mt-1 text-[11px] text-muted">EOD posts at {t.shiftEnd}</p>}
      </div>
    </div>
  );
}

function TeamCard({ team: t, data, botUsername, onChanged }: { team: TeamRow; data: TeamsData; botUsername: string | null; onChanged: () => void }) {
  const canManage = t.canManage;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(t.name);
  const [copied, setCopied] = useState(false);

  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({
        ...s,
        people: t.members
          .filter((m) => s.match(m.position))
          .sort((a, b) => (b.position ? POSITION_RANK[b.position] : 0) - (a.position ? POSITION_RANK[a.position] : 0) || a.name.localeCompare(b.name)),
      })).filter((s) => s.people.length),
    [t.members],
  );
  const notInTeam = data.users.filter((u) => !t.members.some((m) => m._id === u._id));

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const linkCommand = t.linkCode ? `/link ${t.linkCode}` : "";

  return (
    <article className="card overflow-hidden">
      <div className="h-1.5" style={{ background: t.color }} />
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: t.color }}>
            {t.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            {renaming ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run("rename", () => api(`/api/teams/${t._id}`, { method: "PATCH", json: { name } })).then(() => setRenaming(false));
                }}
              >
                <input className="input py-1" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} autoFocus />
                <button className="btn-primary py-1" disabled={busy === "rename"}>
                  Save
                </button>
                <button type="button" className="btn-ghost py-1" onClick={() => (setRenaming(false), setName(t.name))}>
                  Cancel
                </button>
              </form>
            ) : (
              <h3 className="truncate text-lg font-semibold">{t.name}</h3>
            )}
            {t.description && <p className="truncate text-sm text-muted">{t.description}</p>}
            <p className="mt-1 text-xs text-muted">
              {t.members.length} member{t.members.length === 1 ? "" : "s"} · {t.open} open · {t.done} done
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <Link href={`/tracker?team=${t._id}`} className="btn-ghost py-1.5 text-xs">
              Board →
            </Link>
            {canManage && (
              <Link href={`/reports?team=${t._id}`} className="btn-ghost py-1.5 text-xs">
                Reports →
              </Link>
            )}
          </div>
        </div>

        <TeamSetup t={t} data={data} busy={busy} run={run} />

        {/* Telegram connection */}
        <div className={`mt-4 rounded-xl border p-3.5 ${t.telegramLinked ? "border-line bg-surface-2/60" : "border-dashed border-accent/50 bg-accent-soft/40"}`}>
          {t.telegramLinked ? (
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
                <TelegramIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.telegramChatTitle ?? "Telegram group"}</p>
                <p className="text-xs text-muted">Connected {timeAgo(t.telegramLinkedAt)} · members sync automatically</p>
                {canManage ? (
                  <label className="mt-1.5 flex w-fit cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={t.reportsEnabled}
                      disabled={busy === "reports"}
                      onChange={(e) => run("reports", () => api(`/api/teams/${t._id}`, { method: "PATCH", json: { reportsEnabled: e.target.checked } }))}
                    />
                    Post EOD{t.shiftEnd ? ` at ${t.shiftEnd}` : ""} (workdays) &amp; EOW (Fridays) here automatically
                  </label>
                ) : (
                  t.reportsEnabled && <p className="mt-1 text-xs text-muted">EOD &amp; EOW reports are posted here automatically</p>
                )}
              </div>
              {canManage && (
                <button
                  className="text-xs text-muted hover:text-danger"
                  disabled={busy === "unlink"}
                  onClick={() =>
                    confirm(`Disconnect “${t.telegramChatTitle}” from ${t.name}? The bot will stop reading that group.`) &&
                    run("unlink", () => api(`/api/teams/${t._id}/link`, { method: "DELETE" }))
                  }
                >
                  Disconnect
                </button>
              )}
            </div>
          ) : t.linkCode ? (
            <div>
              <p className="text-sm font-medium">Connect {t.name}'s Telegram group</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
                <li>
                  Add {botUsername ? <span className="font-medium text-fg">@{botUsername}</span> : "the bot"} to the group (and make it admin so it sees everyone who joins)
                </li>
                <li>Send this message in the group:</li>
              </ol>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-surface px-3 py-1.5 font-mono text-lg font-semibold tracking-widest">{linkCommand}</code>
                <button
                  className="btn-ghost py-1.5"
                  onClick={async () => {
                    await navigator.clipboard.writeText(linkCommand).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <Spinner className="h-3 w-3" /> Waiting… expires{" "}
                {t.linkCodeExpires && new Date(t.linkCodeExpires).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <TelegramIcon className="h-5 w-5 shrink-0 text-muted" />
              <p className="flex-1 text-sm text-muted">No Telegram group connected yet.</p>
              {canManage && (
                <button className="btn-primary py-1.5" disabled={busy === "link"} onClick={() => run("link", () => api(`/api/teams/${t._id}/link`, { method: "POST" }))}>
                  {busy === "link" && <Spinner />} Connect Telegram group
                </button>
              )}
            </div>
          )}
        </div>

        {/* Members by role */}
        <div className="mt-4 space-y-3">
          {!t.members.length && (
            <p className="text-sm text-muted">
              No members yet.{t.telegramLinked ? " Add people to the Telegram group — they'll appear here." : ""}
            </p>
          )}
          {sections.map((s) => (
            <div key={s.id}>
              <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                {s.label} <span className="font-normal">· {s.people.length}</span>
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {s.people.map((m) => (
                  <span key={m._id} className="group flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-2.5 pl-1 text-sm">
                    <Avatar name={m.name} id={m._id} size={24} presence={m.presence} />
                    <span className="max-w-36 truncate">{m.name}</span>
                    {m.position && s.id !== "lead" && (
                      <span className="text-[10px] text-muted">{POSITION_LABEL[m.position].split(" ")[0]}</span>
                    )}
                    {m.via === "telegram" && <TelegramIcon className="h-3 w-3 text-accent" />}
                    {canManage && (
                      <button
                        className="ml-0.5 hidden text-muted group-hover:inline hover:text-danger focus:inline"
                        title={`Remove ${m.name} from ${t.name}`}
                        aria-label={`Remove ${m.name}`}
                        onClick={() =>
                          confirm(
                            `Remove ${m.name} from ${t.name}?${t.telegramLinked ? " (If they're still in the Telegram group they'll be added back when they post — remove them there too.)" : ""}`,
                          ) && run(`rm-${m._id}`, () => api(`/api/teams/${t._id}/members/${m._id}`, { method: "DELETE" }))
                        }
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {t.pending.length > 0 && (
            <div className="rounded-lg bg-break/10 px-3 py-2.5">
              <h4 className="text-[11px] font-semibold tracking-wider text-break uppercase">Waiting to link · {t.pending.length}</h4>
              <p className="mt-0.5 text-xs text-muted">In the Telegram group but haven't linked a tracker account. They join automatically once they send their /link code.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.pending.map((p) => (
                  <span key={p.telegramId} className="flex items-center gap-1.5 rounded-full border border-dashed border-break/50 px-2.5 py-0.5 text-xs">
                    <TelegramIcon className="h-3 w-3 text-muted" />
                    {p.name}
                    {p.username && <span className="text-muted">@{p.username}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Manager tools */}
        {canManage && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {notInTeam.length > 0 && (
              <select
                className="input w-auto py-1.5 text-xs"
                value=""
                disabled={busy === "add"}
                onChange={(e) => e.target.value && run("add", () => api(`/api/teams/${t._id}/members`, { method: "POST", json: { userId: e.target.value } }))}
                aria-label="Add a member manually"
              >
                <option value="">+ Add someone manually…</option>
                {notInTeam.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name}
                    {u.position ? ` — ${POSITION_LABEL[u.position]}` : ""}
                  </option>
                ))}
              </select>
            )}
            <span className="ml-auto flex gap-3 text-xs">
              {!renaming && (
                <button className="text-muted hover:text-fg" onClick={() => setRenaming(true)}>
                  Rename
                </button>
              )}
              {t.canDelete && (
                <button
                  className="text-muted hover:text-danger"
                  onClick={() =>
                    confirm(`Delete team ${t.name}? Its tickets are kept (without a team) and the Telegram group is disconnected.`) &&
                    run("delete", () => api(`/api/teams/${t._id}`, { method: "DELETE" }))
                  }
                >
                  Delete team
                </button>
              )}
            </span>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
    </article>
  );
}
