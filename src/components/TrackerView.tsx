"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  api,
  duration,
  emitRefresh,
  formatDue,
  isOverdue,
  readPref,
  timeAgo,
  usePolling,
  writePref,
  type Member,
  type TaskRow,
  type TrackerData,
} from "@/lib/client";
import {
  PRIORITY,
  PRIORITY_LABEL,
  TASK_STATUS,
  POSITION_LABEL,
  TASK_STATUS_LABEL,
  canEditTicket,
  isManagerOrAbove,
  type Presence,
  type Priority,
  type TaskStatus,
} from "@/lib/constants";
import ActivityLog from "./ActivityLog";
import TaskModal from "./TaskModal";
import { Avatar, PriorityIcon, ProgressBar, Spinner, TelegramIcon, TicketKey } from "./ui";

const POLL_MS = 5000;
const PRESENCE_ORDER: Record<Presence, number> = { online: 0, break: 1, offline: 2 };
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const COLUMN: Record<TaskStatus, { dot: string; hint?: string }> = {
  todo: { dot: "bg-muted" },
  in_progress: { dot: "bg-accent" },
  blocked: { dot: "bg-danger" },
  done: { dot: "bg-online", hint: "last 30 days" },
};

type Me = TrackerData["me"];

/** A team's tickets — plus tickets without a team (e.g. made in a private chat with the bot) that its members are on. */
const inTeam = (t: TaskRow, team: TrackerData["teams"][number]) =>
  t.team === team._id ||
  (!t.team && [t.assignee?._id, ...(t.collaborators ?? []).map((c) => c._id)].some((id) => !!id && team.memberIds.includes(id)));

const canEdit =(t: TaskRow, me: Me) =>
  canEditTicket(me, {
    team: t.team,
    assigneeId: t.assignee?._id,
    createdById: t.createdBy?._id,
    collaboratorIds: (t.collaborators ?? []).map((c) => c._id),
  });

/** Is the current local time inside the team's shift? (handles shifts crossing midnight) */
function onShift(start: string, end: string, now = new Date()) {
  const cur = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

const TEAM_PREF = "tt.tracker.team";

export default function TrackerView() {
  const { data, error } = usePolling<TrackerData>("/api/tracker", POLL_MS);
  // "" = all teams; null = not decided yet (waits for the first data load).
  const [teamId, setTeamIdState] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [editing, setEditing] = useState<TaskRow | "new" | null>(null);
  const [drawer, setDrawer] = useState(false);
  // Optimistic status while a drag is being saved.
  const [pending, setPending] = useState<Record<string, TaskStatus>>({});
  const [dragging, setDragging] = useState<TaskRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // small move = click, not drag
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  // Pick the starting team: last choice, else your own team (managers see all teams).
  useEffect(() => {
    if (!data || teamId !== null) return;
    const valid = (id: string | null) => id === "" || data.teams.some((t) => t._id === id);
    const fromUrl = new URLSearchParams(window.location.search).get("team");
    const saved = readPref(TEAM_PREF);
    if (fromUrl && valid(fromUrl)) setTeamId(fromUrl);
    else if (saved !== null && valid(saved)) setTeamIdState(saved);
    else setTeamIdState(isManagerOrAbove(data.me) ? "" : (data.me.teamIds[0] ?? ""));
  }, [data, teamId]);

  function setTeamId(id: string) {
    setTeamIdState(id);
    setPerson("");
    writePref(TEAM_PREF, id);
  }

  const team = data?.teams.find((t) => t._id === teamId) ?? null;

  const members = useMemo(
    () =>
      [...(data?.members ?? [])]
        .filter((m) => !team || team.memberIds.includes(m._id))
        .sort((a, b) => PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence] || a.name.localeCompare(b.name)),
    [data?.members, team],
  );

  // Tickets in the selected team (before person/priority/search filters) — used for stats too.
  const teamTasks = useMemo(
    () =>
      (data?.tasks ?? [])
        .filter((t) => !team || inTeam(t, team))
        .map((t) => {
        const s = pending[t._id];
        if (!s || s === t.status) return t;
          const progress = s === "done" ? 100 : t.status === "done" ? (s === "todo" ? 0 : 90) : t.progress;
          return { ...t, status: s, progress };
        }),
    [data?.tasks, pending, team],
  );

  const tasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teamTasks.filter((t) => {
      if (person && t.assignee?._id !== person && !(t.collaborators ?? []).some((c) => c._id === person)) return false;
      if (priority && t.priority !== priority) return false;
      if (q && !`${t.title} tt-${t.number ?? ""} ${t.assignee?.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [teamTasks, person, priority, search]);

  const stats = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return {
      online: members.filter((m) => m.presence === "online").length,
      onBreak: members.filter((m) => m.presence === "break").length,
      offline: members.filter((m) => m.presence === "offline").length,
      inProgress: teamTasks.filter((t) => t.status === "in_progress").length,
      blocked: teamTasks.filter((t) => t.status === "blocked").length,
      doneToday: teamTasks.filter((t) => t.completedAt && new Date(t.completedAt) >= startOfDay).length,
    };
  }, [members, teamTasks]);

  const columns = useMemo(() => {
    const by: Record<TaskStatus, TaskRow[]> = { todo: [], in_progress: [], blocked: [], done: [] };
    for (const t of tasks) by[t.status].push(t);
    for (const s of TASK_STATUS) {
      by[s].sort((a, b) =>
        s === "done"
          ? +new Date(b.completedAt ?? b.updatedAt) - +new Date(a.completedAt ?? a.updatedAt)
          : (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
            (a.dueDate ? +new Date(a.dueDate) : Infinity) - (b.dueDate ? +new Date(b.dueDate) : Infinity) ||
            +new Date(b.updatedAt) - +new Date(a.updatedAt),
      );
    }
    return by;
  }, [tasks]);

  if (!data) {
    return (
      <div className="flex justify-center py-24 text-muted">
        {error ? <p>{error}</p> : <Spinner className="h-6 w-6" />}
      </div>
    );
  }

  const { me } = data;
  const filtered = person || priority || search;

  function onDragStart(e: DragStartEvent) {
    setDragging(data!.tasks.find((t) => t._id === e.active.id) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const task = data!.tasks.find((t) => t._id === e.active.id);
    const to = e.over?.id as TaskStatus | undefined;
    const current = task ? (pending[task._id] ?? task.status) : undefined;
    if (!task || !to || to === current) return;

    setPending((p) => ({ ...p, [task._id]: to }));
    try {
      await api(`/api/tasks/${task._id}`, { method: "PATCH", json: { status: to } });
      emitRefresh();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      // Hold the optimistic state briefly so the card doesn't flicker back before the refetch lands.
      setTimeout(() => setPending(({ [task._id]: _, ...rest }) => rest), 1200);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            {team && <span className="h-3 w-3 rounded-full" style={{ background: team.color }} />}
            {team ? team.name : "All teams"}
          </h1>
          {team?.shiftStart && team.shiftEnd && (
            <p className="mt-1.5 flex items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${
                  onShift(team.shiftStart, team.shiftEnd) ? "bg-online/12 text-online" : "bg-surface-2 text-muted"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${onShift(team.shiftStart, team.shiftEnd) ? "bg-online" : "bg-offline"}`} />
                {onShift(team.shiftStart, team.shiftEnd) ? "On shift" : "Off shift"}
              </span>
              <span className="text-muted">
                🕘 {team.shiftStart}–{team.shiftEnd}
              </span>
            </p>
          )}
          <p className="mt-0.5 text-sm text-muted">
            {team
              ? team.telegramLinked
                ? "Live from this team's Telegram group · drag tickets to change their status"
                : "This team's Telegram group isn't connected yet — connect it on the Team page"
              : "Every team's tickets · drag tickets to change their status"}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setDrawer(true)}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-online" /> Activity
          </button>
          <button className="btn-primary" onClick={() => setEditing("new")}>
            <span className="text-base leading-none">+</span> New ticket
          </button>
        </div>
      </div>

      {/* Team switcher */}
      {data.teams.length > 0 && (
        <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Teams">
          <TeamTab active={teamId === ""} onClick={() => setTeamId("")} label="All teams" count={data.tasks.filter((t) => t.status !== "done").length} />
          {data.teams.map((t) => (
            <TeamTab
              key={t._id}
              active={teamId === t._id}
              onClick={() => setTeamId(t._id)}
              label={t.name}
              color={t.color}
              linked={t.telegramLinked}
              mine={me.teamIds.includes(t._id)}
              count={data.tasks.filter((x) => inTeam(x, t) && x.status !== "done").length}
            />
          ))}
        </nav>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
        <Stat label="Online" value={stats.online} tone="text-online" dot="bg-online" />
        <Stat label="On break" value={stats.onBreak} tone="text-break" dot="bg-break" />
        <Stat label="Offline" value={stats.offline} tone="text-offline" dot="bg-offline" />
        <Stat label="In progress" value={stats.inProgress} tone="text-accent" />
        <Stat label="Blocked" value={stats.blocked} tone={stats.blocked ? "text-danger" : "text-muted"} />
        <Stat label="Done today" value={stats.doneToday} tone="text-online" />
      </div>

      {/* Team strip */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {team ? "Members" : "Everyone"}
            <span className="ml-2 font-normal text-muted">{members.length}</span>
          </h2>
          <span className="text-xs text-muted">Click someone to see only their tickets</span>
        </div>
        {team && !members.length && (
          <p className="card px-4 py-6 text-center text-sm text-muted">
            No members yet — add people to {team.name}'s Telegram group and they'll appear here.
          </p>
        )}
        <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {members.map((m) => (
            <MemberChip
              key={m._id}
              member={m}
              active={person === m._id}
              onClick={() => setPerson((p) => (p === m._id ? "" : m._id))}
            />
          ))}
        </div>
      </section>

      {/* Board toolbar */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold">
            Board
            <span className="ml-2 font-normal text-muted">
              {tasks.length} ticket{tasks.length === 1 ? "" : "s"}
            </span>
          </h2>
          <div className="relative w-full sm:w-60">
            <svg viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="9" cy="9" r="5.5" />
              <path d="m13.5 13.5 3 3" strokeLinecap="round" />
            </svg>
            <input
              className="input py-1.5 pl-8"
              placeholder="Search title, TT-12, name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tickets"
            />
          </div>
          <select
            className="input w-auto py-1.5"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority | "")}
            aria-label="Priority"
          >
            <option value="">Any priority</option>
            {PRIORITY.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
          <button
            className={`btn-ghost py-1.5 ${person === me._id ? "border-accent bg-accent-soft text-accent" : ""}`}
            onClick={() => setPerson((p) => (p === me._id ? "" : me._id))}
          >
            My tickets
          </button>
          {filtered && (
            <button
              className="px-1 text-xs font-medium text-accent hover:underline"
              onClick={() => {
                setPerson("");
                setPriority("");
                setSearch("");
              }}
            >
              Clear
            </button>
          )}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-4 lg:overflow-visible">
            {TASK_STATUS.map((s) => (
              <Column
                key={s}
                status={s}
                tasks={columns[s]}
                me={me}
                dragging={dragging}
                onOpen={setEditing}
                onAdd={s === "todo" ? () => setEditing("new") : undefined}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
            {dragging ? <TicketCard task={dragging} overlay /> : null}
          </DragOverlay>
        </DndContext>
      </section>

      {editing && (
        <TaskModal
          task={editing === "new" ? null : editing}
          members={data.members}
          teams={data.teams}
          defaultTeamId={team?._id ?? (me.teamIds.length === 1 ? me.teamIds[0] : null)}
          me={me}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Activity drawer */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity ${drawer ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setDrawer(false)}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-bg shadow-2xl transition-transform duration-300 ${
          drawer ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!drawer}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="font-semibold">Recent activity</h2>
          <button onClick={() => setDrawer(false)} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>
        {drawer && (
          <ActivityLog members={data.members} viewAllHref="/activity" title="Live" className="m-4 mt-2 min-h-0 flex-1" />
        )}
      </aside>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-fg px-4 py-2.5 text-sm text-bg shadow-lg" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function TeamTab({
  active,
  onClick,
  label,
  count,
  color,
  linked,
  mine,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
  linked?: boolean;
  mine?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
        active ? "border-fg bg-fg text-bg" : "border-line bg-surface text-fg/80 hover:border-accent/50"
      }`}
    >
      {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
      {label}
      {mine && <span className={`text-[10px] font-semibold uppercase ${active ? "opacity-70" : "text-accent"}`}>you</span>}
      {linked === false && (
        <span title="Telegram group not connected" className={active ? "opacity-60" : "text-muted"}>
          <TelegramIcon className="h-3 w-3 opacity-50" />
        </span>
      )}
      <span className={`rounded-md px-1.5 text-xs tabular-nums ${active ? "bg-bg/20" : "bg-surface-2 text-muted"}`}>{count}</span>
    </button>
  );
}

function Stat({ label, value, tone, dot }: { label: string; value: number; tone: string; dot?: string }) {
  return (
    <div className="card px-3.5 py-3">
      <p className="flex items-center gap-1.5 truncate text-xs text-muted">
        {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />}
        {label}
      </p>
      <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function MemberChip({ member: m, active, onClick }: { member: Member; active: boolean; onClick: () => void }) {
  const tone: Record<Presence, string> = { online: "text-online", break: "text-break", offline: "text-offline" };
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={m.presenceNote ? `“${m.presenceNote}” · seen ${timeAgo(m.lastSeenAt)}` : `Seen ${timeAgo(m.lastSeenAt)}`}
      className={`card flex w-56 shrink-0 snap-start items-center gap-3 p-2.5 pr-3 text-left transition hover:border-accent/50 ${
        active ? "border-accent ring-2 ring-accent/20" : ""
      }`}
    >
      <Avatar name={m.name} id={m._id} presence={m.presence} size={38} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{m.name}</span>
          {m.telegramId && <TelegramIcon className="h-3 w-3 shrink-0 text-accent" />}
        </p>
        <p className="truncate text-[11px] text-muted">{m.position ? POSITION_LABEL[m.position] : "No role yet"}</p>
        <p className="truncate text-xs">
          <span className={`font-medium ${tone[m.presence]}`}>
            {m.presence === "online" ? "Online" : m.presence === "break" ? "Break" : "Offline"}
          </span>
          <span className="text-muted"> · {duration(m.presenceSince)}</span>
          {m.presenceNote && <span className="text-muted italic"> · {m.presenceNote}</span>}
        </p>
      </div>
      <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted" title="Open tickets">
        {m.openTasks}
      </span>
    </button>
  );
}

function Column({
  status,
  tasks,
  me,
  dragging,
  onOpen,
  onAdd,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  me: Me;
  dragging: TaskRow | null;
  onOpen: (t: TaskRow) => void;
  onAdd?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const isSource = dragging?.status === status;
  const col = COLUMN[status];

  return (
    <div className="flex w-[82vw] max-w-80 shrink-0 snap-start flex-col sm:w-72 lg:w-auto lg:max-w-none">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={`h-2 w-2 rounded-full ${col.dot}`} />
        <h3 className="text-xs font-semibold tracking-wide uppercase">{TASK_STATUS_LABEL[status]}</h3>
        <span className="rounded-full bg-surface-2 px-1.5 text-xs font-medium tabular-nums text-muted">{tasks.length}</span>
        {col.hint && <span className="text-[11px] text-muted">· {col.hint}</span>}
        {onAdd && (
          <button onClick={onAdd} className="ml-auto rounded-md px-1.5 text-lg leading-none text-muted hover:bg-surface-2 hover:text-fg" aria-label="New ticket">
            +
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-40 flex-1 flex-col gap-2 rounded-xl border-2 border-dashed p-2 transition-colors lg:max-h-[calc(100vh-17rem)] lg:min-h-[calc(100vh-24rem)] lg:overflow-y-auto ${
          isOver && !isSource
            ? "border-accent bg-surface-2"
            : dragging
              ? "border-line bg-surface-2"
              : "border-transparent bg-surface-2"
        }`}
      >
        {tasks.map((t) => (
          <DraggableTicket key={t._id} task={t} disabled={!canEdit(t, me)} onOpen={() => onOpen(t)} />
        ))}
        {!tasks.length && (
          <p className="m-auto py-6 text-center text-xs text-muted">{dragging && !isSource ? "Drop here" : "No tickets"}</p>
        )}
      </div>
    </div>
  );
}

function DraggableTicket({ task, disabled, onOpen }: { task: TaskRow; disabled: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task._id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter") onOpen();
      }}
      className={`rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent ${isDragging ? "opacity-30" : ""} ${
        disabled ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      }`}
      aria-roledescription={disabled ? "ticket" : "draggable ticket"}
      title={disabled ? "Only the assignee, the creator, the team's Team Lead or a Manager can move this ticket" : undefined}
    >
      <TicketCard task={task} />
    </div>
  );
}

const PRIORITY_EDGE: Record<Priority, string> = {
  low: "before:bg-line",
  medium: "before:bg-accent/60",
  high: "before:bg-break",
  urgent: "before:bg-offline",
};

function TicketCard({ task: t, overlay = false }: { task: TaskRow; overlay?: boolean }) {
  const due = formatDue(t.dueDate);
  const overdue = isOverdue(t);
  const done = t.status === "done";
  return (
    <article
      className={`relative overflow-hidden rounded-xl border border-line bg-surface p-3 pl-3.5 transition before:absolute before:inset-y-0 before:left-0 before:w-1 hover:border-accent/40 hover:shadow-sm ${
        PRIORITY_EDGE[t.priority] ?? PRIORITY_EDGE.medium
      } ${overlay ? "rotate-2 shadow-xl ring-1 ring-accent/30" : ""}`}
    >
      <header className="flex items-center gap-2">
        <TicketKey number={t.number} />
        {t.source === "telegram" && <TelegramIcon className="h-3 w-3 text-accent" />}
        <span className="ml-auto">
          <PriorityIcon priority={t.priority} />
        </span>
      </header>

      <h4 className={`mt-1.5 line-clamp-2 text-sm leading-snug font-medium ${done ? "text-muted line-through decoration-muted/50" : ""}`}>
        {t.title}
      </h4>

      {(t.status === "in_progress" || t.status === "blocked" || (t.status === "todo" && t.progress > 0)) && (
        <div className="mt-2.5 flex items-center gap-2">
          <ProgressBar value={t.progress} status={t.status} />
          <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted">{t.progress}%</span>
        </div>
      )}

      {/* Ticket perforation */}
      <div className="relative -mx-3.5 my-2.5 border-t border-dashed border-line">
        <span className="absolute -top-1.5 -left-1.5 h-3 w-3 rounded-full border border-line bg-surface-2" />
        <span className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full border border-line bg-surface-2" />
      </div>

      <footer className="flex items-center gap-2 text-[11px] text-muted">
        {done ? (
          <span className="flex items-center gap-1 font-medium text-online">✓ Done {t.completedAt ? timeAgo(t.completedAt) : ""}</span>
        ) : due ? (
          <span className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 ${overdue ? "bg-danger/12 font-semibold text-danger" : "bg-surface-2"}`}>
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <rect x="2" y="3" width="12" height="11" rx="2" />
              <path d="M2 7h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
            </svg>
            {overdue ? "Overdue · " : ""}
            {due}
          </span>
        ) : (
          <span>Updated {timeAgo(t.updatedAt)}</span>
        )}
        <span
          className="ml-auto flex items-center -space-x-1.5"
          title={
            t.assignee
              ? `Assigned to ${t.assignee.name}${t.collaborators?.length ? ` · with ${t.collaborators.map((c) => c.name).join(", ")}` : ""}`
              : "Unassigned"
          }
        >
          {t.assignee ? (
            [t.assignee, ...(t.collaborators ?? [])].slice(0, 3).map((p) => (
              <span key={p._id} className="rounded-full ring-2 ring-surface">
                <Avatar name={p.name} id={p._id} size={22} />
              </span>
            ))
          ) : (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-muted/60 text-[10px]">?</span>
          )}
          {(t.collaborators?.length ?? 0) > 2 && <span className="pl-2.5 text-[10px] font-semibold">+{t.collaborators.length - 2}</span>}
        </span>
      </footer>
    </article>
  );
}
