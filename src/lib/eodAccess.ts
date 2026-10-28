import "server-only";
import { isValidObjectId, Types } from "mongoose";
import { POSITIONS, POSITION_RANK, isManagerOrAbove, rankOf } from "./constants";
import { User, type IUser } from "./models/User";
import { hiddenIdsFor } from "./admin";

/**
 * Whose EOD / EOW a viewer may open (read-only unless it's their own):
 * themselves; Managers and the admin — anyone; Team Leads — every employee below Manager.
 */
export async function eodPeopleFor(viewer: IUser) {
  const me = { _id: String(viewer._id), role: viewer.role, position: viewer.position ?? null };
  const hidden = await hiddenIdsFor(viewer);
  let filter: Record<string, unknown> | null = null;
  if (isManagerOrAbove(me)) {
    filter = { _id: { $nin: hidden.map((id) => new Types.ObjectId(id)) } };
  } else if (rankOf(me.position) >= POSITION_RANK.team_lead) {
    // Every employee, in any team — but not Managers and above.
    filter = {
      _id: { $nin: hidden.map((id) => new Types.ObjectId(id)) },
      position: { $nin: POSITIONS.filter((p) => POSITION_RANK[p] > POSITION_RANK.team_lead) },
    };
  }
  const others = filter
    ? await User.find({ ...filter, _id: { ...(filter._id as object), $ne: viewer._id } }).select("name position").sort({ name: 1 }).lean()
    : [];
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
