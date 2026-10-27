"use client";

import { useEffect, useState } from "react";
import { api, emitRefresh, formatDateTime, type Member, type TaskRow, type TeamSummary } from "@/lib/client";
import {
  POSITION_LABEL,
  PRIORITY,
  PRIORITY_LABEL,
  TASK_STATUS,
  TASK_STATUS_LABEL,
  canDeleteAnyTicket,
  canEditTicket,
  type Position,
  type Priority,
  type TaskStatus,
} from "@/lib/constants";
import TicketHistory from "./TicketHistory";
import { Avatar, PriorityIcon, SourceTag, Spinner, TicketKey } from "./ui";

interface Props {
  task: TaskRow | null; // null → create
  members: Member[];
  teams: TeamSummary[];
  /** Team pre-selected for a new ticket. */
  defaultTeamId?: string | null;
  me: { _id: string; role: "admin" | "member"; position: Position | null; teamIds: string[] };
  onClose: () => void;
}

function MemberOption({ m }: { m: Member }) {
  return (
    <option value={m._id}>
      {m.name}
      {m.position ? ` — ${POSITION_LABEL[m.position]}` : ""}
    </option>
  );
}

export default function TaskModal({ task, members, teams, defaultTeamId, me, onClose }: Props) {
  const isNew = !task;
  const canEdit =
    isNew ||
    canEditTicket(me, {
      team: task.team,
      assigneeId: task.assignee?._id,
      createdById: task.createdBy?._id,
      collaboratorIds: (task.collaborators ?? []).map((c) => c._id),
    });
  const canDelete = !isNew && (canDeleteAnyTicket(me) || task.createdBy?._id === me._id);

  const [form, setForm] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    teamId: (task ? task.team : defaultTeamId) ?? "",
    assigneeId: task?.assignee?._id ?? me._id,
    collaboratorIds: (task?.collaborators ?? []).map((c) => c._id),
    dueDate: task?.dueDate ? task.dueDate.slice(0, 10) : "",
    status: (task?.status ?? "todo") as TaskStatus,
    progress: task?.progress ?? 0,
    priority: (task?.priority ?? "medium") as Priority,
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTeam = teams.find((t) => t._id === form.teamId) ?? null;
  const inTeam = selectedTeam ? members.filter((m) => selectedTeam.memberIds.includes(m._id)) : members;
  const others = selectedTeam ? members.filter((m) => !selectedTeam.memberIds.includes(m._id)) : [];
  // Collaborator choices: the team first, then anyone already on the ticket.
  const helperChoices = [...inTeam, ...others.filter((m) => form.collaboratorIds.includes(m._id))].filter(
    (m) => m._id !== form.assigneeId,
  );
  const toggleHelper = (id: string) =>
    setForm((f) => ({
      ...f,
      collaboratorIds: f.collaboratorIds.includes(id) ? f.collaboratorIds.filter((x) => x !== id) : [...f.collaboratorIds, id],
    }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: form.title,
        description: form.description || null,
        assigneeId: form.assigneeId || null,
        teamId: form.teamId || null,
        collaboratorIds: form.collaboratorIds.filter((id) => id !== form.assigneeId),
        dueDate: form.dueDate || null,
        progress: form.progress,
        priority: form.priority,
        ...(isNew ? {} : { status: form.status, note: form.note || null }),
      };
      await api(isNew ? "/api/tasks" : `/api/tasks/${task._id}`, {
        method: isNew ? "POST" : "PATCH",
        json: body,
      });
      emitRefresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!task || !confirm(`Delete “${task.title}”? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api(`/api/tasks/${task._id}`, { method: "DELETE" });
      emitRefresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const set =
    <K extends keyof typeof form>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => {
        const next = { ...f, [k]: k === "progress" ? Number(e.target.value) : e.target.value };
        // Keep the status dropdown and progress slider in agreement.
        if (k === "progress") {
          if (next.progress >= 100) next.status = "done";
          else if (f.status === "done") next.status = "in_progress";
          else if (f.status === "todo" && next.progress > 0) next.status = "in_progress";
        }
        if (k === "status" && next.status === "done") next.progress = 100;
        return next;
      });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-modal-title"
        className="card flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none shadow-2xl sm:rounded-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="task-modal-title" className="flex items-center gap-2.5 font-semibold">
            {task?.number ? <TicketKey number={task.number} className="rounded-md bg-surface-2 px-2 py-1 text-xs" /> : null}
            {isNew ? "New ticket" : canEdit ? "Edit ticket" : "Ticket"}
            {!isNew && <PriorityIcon priority={form.priority} withLabel />}
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto">
          <form id="task-form" onSubmit={save} className="space-y-4 p-5">
            <fieldset disabled={!canEdit || busy} className="space-y-4">
              <div>
                <label className="label" htmlFor="t-title">Title</label>
                <input id="t-title" className="input" value={form.title} onChange={set("title")} required minLength={2} autoFocus={isNew} />
              </div>
              <div>
                <label className="label" htmlFor="t-desc">Description</label>
                <textarea id="t-desc" className="input min-h-20 resize-y" value={form.description} onChange={set("description")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {teams.length > 0 && (
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="t-team">Team</label>
                    <select id="t-team" className="input" value={form.teamId} onChange={set("teamId")}>
                      <option value="">No team</option>
                      {teams.map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="label" htmlFor="t-assignee">Assignee</label>
                  <select id="t-assignee" className="input" value={form.assigneeId} onChange={set("assigneeId")}>
                    <option value="">Unassigned</option>
                    {selectedTeam ? (
                      <>
                        <optgroup label={`In ${selectedTeam.name}`}>
                          {inTeam.map((m) => (
                            <MemberOption key={m._id} m={m} />
                          ))}
                        </optgroup>
                        {others.length > 0 && (
                          <optgroup label="Other people">
                            {others.map((m) => (
                              <MemberOption key={m._id} m={m} />
                            ))}
                          </optgroup>
                        )}
                      </>
                    ) : (
                      members.map((m) => <MemberOption key={m._id} m={m} />)
                    )}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="t-due">Due date</label>
                  <input id="t-due" type="date" className="input" value={form.dueDate} onChange={set("dueDate")} />
                </div>
                <div className="sm:col-span-2">
                  <span className="label">
                    Working on it too <span className="font-normal">· e.g. a designer and a developer on the same ticket</span>
                  </span>
                  {helperChoices.length ? (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Collaborators">
                      {helperChoices.map((m) => {
                        const on = form.collaboratorIds.includes(m._id);
                        return (
                          <button
                            key={m._id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleHelper(m._id)}
                            className={`flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-xs transition ${
                              on ? "border-accent bg-accent-soft font-medium text-fg" : "border-line text-muted hover:border-accent/50 hover:text-fg"
                            }`}
                          >
                            <Avatar name={m.name} id={m._id} size={20} />
                            {m.name}
                            {m.position && <span className="text-[10px] opacity-70">{POSITION_LABEL[m.position].split(" ").pop()}</span>}
                            {on && <span aria-hidden>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">No one else in this team yet.</p>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <span className="label">Priority</span>
                  <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Priority">
                    {PRIORITY.map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={form.priority === p}
                        onClick={() => setForm((f) => ({ ...f, priority: p }))}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                          form.priority === p ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:bg-surface-2"
                        }`}
                      >
                        <PriorityIcon priority={p} />
                        {PRIORITY_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </div>
                {!isNew && (
                  <div>
                    <label className="label" htmlFor="t-status">Status</label>
                    <select id="t-status" className="input" value={form.status} onChange={set("status")}>
                      {TASK_STATUS.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className={isNew ? "sm:col-span-2" : ""}>
                  <label className="label" htmlFor="t-progress">
                    Progress — <span className="font-semibold text-fg">{form.progress}%</span>
                  </label>
                  <input
                    id="t-progress"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={form.progress}
                    onChange={set("progress")}
                    className="mt-2 w-full accent-[var(--accent)]"
                  />
                </div>
              </div>
              {!isNew && (
                <div>
                  <label className="label" htmlFor="t-note">Note for the log (optional)</label>
                  <input id="t-note" className="input" value={form.note} onChange={set("note")} placeholder="e.g. waiting on API keys" />
                </div>
              )}
            </fieldset>
            {!canEdit && (
              <p className="text-xs text-muted">Only people on this ticket, its creator, the team's Team Lead or a Manager can edit it.</p>
            )}
            {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            {task && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                Created {formatDateTime(task.createdAt)}
                {task.createdBy && <> by {task.createdBy.name}</>} · <SourceTag source={task.source} />
              </p>
            )}
          </form>

          {task && (
            <div className="border-t border-line p-5 pt-4">
              <h3 className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Ticket history · day by day</h3>
              <TicketHistory key={task._id} taskId={task._id} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {canDelete && (
            <button type="button" onClick={remove} className="btn-danger" disabled={busy}>
              Delete
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              {canEdit ? "Cancel" : "Close"}
            </button>
            {canEdit && (
              <button form="task-form" className="btn-primary" disabled={busy}>
                {busy && <Spinner />} {isNew ? "Create ticket" : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
