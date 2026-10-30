import { Types } from "mongoose";
import { POSITION_RANK, rankOf, type Position } from "./constants";
import { Team } from "./models/Team";

interface Overseer {
  _id: string | Types.ObjectId;
  role?: string | null;
  position?: Position | null;
}

/** The teams someone oversees. Null means every team. Empty means none. */
export async function overseenTeamIds(u: Overseer): Promise<string[] | null> {
  const rank = rankOf(u.position);
  // The admin and Senior Managers see the whole company.
  if (u.role === "admin" || rank >= POSITION_RANK.senior_manager) return null;
  const uid = new Types.ObjectId(String(u._id));
  if (rank >= POSITION_RANK.manager) {
    // The teams they manage or are in. A Manager with no team oversees them all.
    const teams = await Team.find({ $or: [{ manager: uid }, { "members.user": uid }] }).select("_id").lean();
    return teams.length ? teams.map((t) => String(t._id)) : null;
  }
  if (rank >= POSITION_RANK.team_lead) {
    // One team: the one they lead, else the one they're in.
    const team =
      (await Team.findOne({ lead: uid }).select("_id").sort({ createdAt: 1 }).lean()) ??
      (await Team.findOne({ "members.user": uid }).select("_id").sort({ createdAt: 1 }).lean());
    return team ? [String(team._id)] : [];
  }
  return [];
}

/** The same teams, with names, sorted by name. */
export async function overseenTeams(u: Overseer) {
  const ids = await overseenTeamIds(u);
  if (ids && !ids.length) return [];
  return Team.find(ids ? { _id: { $in: ids } } : {})
    .select("_id name lead members")
    .sort({ name: 1 })
    .lean();
}
