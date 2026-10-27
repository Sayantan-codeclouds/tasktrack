import "server-only";
import { isValidObjectId } from "mongoose";
import { jsonError } from "./api";
import { canManageTeam } from "./constants";
import { Team } from "./models/Team";
import type { IUser } from "./models/User";

export const actorOf = (user: IUser) => ({ _id: String(user._id), role: user.role, position: user.position ?? null });

/** For team-management routes: the team, or an error response if missing / not allowed. */
export async function loadManagedTeam(id: string, user: IUser) {
  if (!isValidObjectId(id)) return { ok: false as const, error: jsonError("Team not found", 404) };
  const team = await Team.findById(id);
  if (!team) return { ok: false as const, error: jsonError("Team not found", 404) };
  const allowed = canManageTeam(actorOf(user), {
    lead: team.lead ? String(team.lead) : null,
    manager: team.manager ? String(team.manager) : null,
  });
  if (!allowed) {
    return { ok: false as const, error: jsonError("Only this team's Team Lead, its Manager, or a Manager and above can do that", 403) };
  }
  return { ok: true as const, team };
}
