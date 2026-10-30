import "server-only";
import { isValidObjectId, Types } from "mongoose";
import { POSITIONS, POSITION_RANK, isManagerOrAbove, rankOf, type Position } from "./constants";
import { Team } from "./models/Team";
import { overseenTeamIds } from "./oversight";
import { User, type IUser } from "./models/User";
import { hiddenIdsFor } from "./admin";

/**
 * Whose EOD / EOW a viewer may open (read-only unless it's their own): themselves, plus the people in
 * the teams they oversee (see overseenTeamIds). Senior Managers and the admin: everyone. Managers: their
 * teams. Team Leads: their one team, below Manager.
 */
export async function eodPeopleFor(viewer: IUser) {
  const me = { _id: String(viewer._id), role: viewer.role, position: viewer.position ?? null };
  const lead = isManagerOrAbove(me) || rankOf(me.position) >= POSITION_RANK.team_lead;
  const teamIds = lead ? await overseenTeamIds(me) : [];
  let others: { _id: Types.ObjectId; name: string; position?: Position | null }[] = [];
  if (!teamIds || teamIds.length) {
    const hidden = (await hiddenIdsFor(viewer)).map((id) => new Types.ObjectId(id));
    const filter: Record<string, unknown> = { _id: { $nin: hidden, $ne: viewer._id } };
    if (teamIds) {
      const teams = await Team.find({ _id: { $in: teamIds } }).select("lead members.user").lean();
      const ids = teams.flatMap((t) => [...t.members.map((m) => String(m.user)), ...(t.lead ? [String(t.lead)] : [])]);
      filter.$and = [{ _id: { $in: [...new Set(ids)].map((id) => new Types.ObjectId(id)) } }];
    }
    // Team Leads don't see their Managers' EODs.
    if (!isManagerOrAbove(me)) filter.position = { $nin: POSITIONS.filter((p) => POSITION_RANK[p] > POSITION_RANK.team_lead) };
    others = await User.find(filter).select("name position").sort({ name: 1 }).lean();
  }
  return [
    { _id: me._id, name: viewer.name, position: viewer.position ?? null, me: true },
    ...others.map((u) => ({ _id: String(u._id), name: u.name, position: u.position ?? null, me: false })),
  ];
}

/** The person whose EOD the request is for — the viewer, unless ?user= names someone they may see. */
export async function eodTargetFor(viewer: IUser, requested: string | null): Promise<string | null> {
  if (!requested || requested === String(viewer._id)) return String(viewer._id);
  if (!isValidObjectId(requested)) return null;
  const people = await eodPeopleFor(viewer);
  return people.some((p) => p._id === requested) ? requested : null;
}
