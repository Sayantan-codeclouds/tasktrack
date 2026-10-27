import "server-only";
import { isValidObjectId } from "mongoose";
import { jsonError } from "./api";
import { canViewTeamReports } from "./constants";
import { teamIdsForUser } from "./teams";
import { appTimeZone, dayKey, isYmd } from "./time";
import type { IUser } from "./models/User";
import type { Period } from "./reports";

/** Validates ?team / period / date and the viewer's access. */
export async function reportParams(user: IUser, input: { team?: string | null; period?: string | null; date?: string | null }) {
  const team = input.team ?? "";
  if (!isValidObjectId(team)) return { ok: false as const, error: jsonError("Choose a team", 400) };
  const actor = { _id: String(user._id), role: user.role, position: user.position ?? null, teamIds: await teamIdsForUser(user._id) };
  if (!canViewTeamReports(actor, team)) {
    return { ok: false as const, error: jsonError("Reports are for Managers, and Team Leads of this team", 403) };
  }
  const period: Period = input.period === "week" ? "week" : "day";
  const date = isYmd(input.date) ? input.date : dayKey(new Date(), appTimeZone());
  return { ok: true as const, team, period, date };
}
