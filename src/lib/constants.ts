// Shared between server, bot and browser code — keep this file free of server-only imports.

export const PRESENCE = ["online", "break", "offline"] as const;
export type Presence = (typeof PRESENCE)[number];

export const TASK_STATUS = ["todo", "in_progress", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

// ---------- Job roles (positions) ----------

export const POSITIONS = [
  "senior_manager",
  "manager",
  "team_lead",
  "senior_developer",
  "junior_developer",
  "senior_designer",
  "junior_designer",
] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABEL: Record<Position, string> = {
  senior_manager: "Senior Manager",
  manager: "Manager",
  team_lead: "Team Lead",
  senior_developer: "Senior Developer",
  junior_developer: "Junior Developer",
  senior_designer: "Senior Designer",
  junior_designer: "Junior Designer",
};

/** Seniority used for permissions. Senior/junior developers and designers share levels. */
export const POSITION_RANK: Record<Position, number> = {
  senior_manager: 5,
  manager: 4,
  team_lead: 3,
  senior_developer: 2,
  senior_designer: 2,
  junior_developer: 1,
  junior_designer: 1,
};

export const POSITION_GROUP: Record<Position, "management" | "lead" | "development" | "design"> = {
  senior_manager: "management",
  manager: "management",
  team_lead: "lead",
  senior_developer: "development",
  junior_developer: "development",
  senior_designer: "design",
  junior_designer: "design",
};

interface Actor {
  _id: string;
  role: "admin" | "member";
  position?: Position | null;
}

export const rankOf = (p?: Position | null) => (p ? POSITION_RANK[p] : 0);

/** Roles people can give themselves at sign-up; anything higher needs approval. */
export const isSelfServeRole = (p: Position) => POSITION_RANK[p] < POSITION_RANK.team_lead;

/** Managers and above (and admin) see and act on every team's tickets. */
export const isManagerOrAbove = (u: Actor) => u.role === "admin" || rankOf(u.position) >= POSITION_RANK.manager;

/** Managers (they then assign a Team Lead) and Team Leads (they assign an overseeing Manager) create teams. */
export const canCreateTeams = (u: Actor) => isManagerOrAbove(u) || rankOf(u.position) >= POSITION_RANK.team_lead;

/** @deprecated use canCreateTeams / canManageTeam */
export const canManageTeams = canCreateTeams;

/**
 * Who runs a team (rename, shift, Telegram group, members, lead/manager):
 * admin and any Manager, plus the team's own Team Lead and overseeing Manager.
 */
export function canManageTeam(u: Actor, team: { lead?: string | null; manager?: string | null }) {
  return isManagerOrAbove(u) || (!!team.lead && team.lead === u._id) || (!!team.manager && team.manager === u._id);
}

/** EOD/EOW reports and day-by-day progress: Managers (any team) and Team Leads (their teams). */
export function canViewTeamReports(u: Actor & { teamIds?: string[] }, teamId: string) {
  if (isManagerOrAbove(u)) return true;
  return rankOf(u.position) >= POSITION_RANK.team_lead && (u.teamIds ?? []).includes(teamId);
}

/** People who can be a team's lead / overseeing manager. */
export const canBeTeamLead = (p?: Position | null) => rankOf(p) >= POSITION_RANK.team_lead;
export const canBeTeamManager = (p?: Position | null) => rankOf(p) >= POSITION_RANK.manager;

/** "HH:MM" 24h. */
export const isHhmm = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Whether to show the Reports page at all. */
export const canSeeReports = (u: Actor & { teamIds?: string[] }) =>
  isManagerOrAbove(u) || (rankOf(u.position) >= POSITION_RANK.team_lead && (u.teamIds ?? []).length > 0);

/**
 * Who may edit or move a ticket:
 * - Managers and above: any ticket.
 * - Team Leads: tickets of teams they belong to, and tickets without a team.
 * - Everyone: tickets assigned to them, shared with them (collaborators), or created by them.
 */
export function canEditTicket(
  u: Actor & { teamIds?: string[] },
  t: { team?: string | null; assigneeId?: string | null; createdById?: string | null; collaboratorIds?: string[] },
) {
  if (isManagerOrAbove(u)) return true;
  if (t.assigneeId === u._id || t.createdById === u._id || (t.collaboratorIds ?? []).includes(u._id)) return true;
  if (rankOf(u.position) >= POSITION_RANK.team_lead) return !t.team || (u.teamIds ?? []).includes(t.team);
  return false;
}

/** Managers and above can delete any ticket. */
export const canDeleteAnyTicket = (u: Actor) => u.role === "admin" || rankOf(u.position) >= POSITION_RANK.manager;

/** Managers and above can assign roles (within their limits — see canSetPosition). */
export const canAssignRoles = (u: Actor) => u.role === "admin" || rankOf(u.position) >= POSITION_RANK.manager;

/**
 * Admin: anyone, any role (including themselves).
 * Managers: only people ranked below them, and only to roles ranked below them. Never themselves.
 */
export function canSetPosition(actor: Actor, target: { _id: string; position?: Position | null }, next: Position | null) {
  if (actor.role === "admin") return true;
  if (!canAssignRoles(actor) || actor._id === target._id) return false;
  const mine = rankOf(actor.position);
  return rankOf(target.position) < mine && rankOf(next) < mine;
}

/** Roles this actor may hand out (for the dropdown). */
export const assignablePositions = (actor: Actor) =>
  actor.role === "admin" ? [...POSITIONS] : POSITIONS.filter((p) => POSITION_RANK[p] < rankOf(actor.position));

export const PRIORITY = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITY)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/** Tickets are shown as `${TICKET_PREFIX}-${number}`, e.g. TT-12. */
export const TICKET_PREFIX = "TT";
export const ticketKey = (n: number | null | undefined) => (n ? `${TICKET_PREFIX}-${n}` : "");

export const ACTIVITY_TYPES = [
  "status_change",
  "task_created",
  "task_progress",
  "task_status",
  "task_completed",
  "task_deleted",
  "account_linked",
  "account_unlinked",
  "login",
  "profile_updated",
  "role_changed",
  "team_created",
  "team_updated",
  "team_deleted",
  "team_linked",
  "team_unlinked",
  "member_joined",
  "member_left",
  "eod_note",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const SOURCES = ["telegram", "web", "system"] as const;
export type Source = (typeof SOURCES)[number];

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Online",
  break: "On break",
  offline: "Offline",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  status_change: "Status",
  task_created: "Task created",
  task_progress: "Progress",
  task_status: "Task status",
  task_completed: "Completed",
  task_deleted: "Task deleted",
  account_linked: "Telegram linked",
  account_unlinked: "Telegram unlinked",
  login: "Login",
  profile_updated: "Profile",
  role_changed: "Role",
  team_created: "Team created",
  team_updated: "Team updated",
  team_deleted: "Team deleted",
  team_linked: "Group connected",
  team_unlinked: "Group disconnected",
  member_joined: "Joined team",
  member_left: "Left team",
  eod_note: "EOD note",
};

/** Team accent colours, picked in creation order. */
export const TEAM_COLORS = ["#4c6ef5", "#12b886", "#f76707", "#ae3ec9", "#1c7ed6", "#e64980", "#2f9e44", "#f59f00"];
