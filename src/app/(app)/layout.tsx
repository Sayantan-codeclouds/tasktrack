import { redirect } from "next/navigation";
import { getCurrentUser, getImpersonatorId } from "@/lib/auth";
import NavBar from "@/components/NavBar";
import { canCreateTeams, canSeeReports } from "@/lib/constants";
import { teamIdsForUser } from "@/lib/teams";
import { Team } from "@/lib/models/Team";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const teamIds = await teamIdsForUser(user._id);
  const showReports = canSeeReports({
    _id: String(user._id),
    role: user.role,
    position: user.position ?? null,
    teamIds,
  });
  // Their teams' meeting links, for the Meeting button.
  const meetings = (await Team.find({ _id: { $in: teamIds }, meetingUrl: { $ne: null } }).select("name meetingUrl").sort({ name: 1 }).lean()).map((t) => ({
    team: t.name,
    url: t.meetingUrl!,
  }));

  return (
    <>
      <NavBar
        user={{
          _id: String(user._id),
          name: user.name,
          presence: user.presence,
          presenceNote: user.presenceNote ?? null,
          telegramLinked: Boolean(user.telegramId),
        }}
        showReports={showReports}
        meetings={meetings}
        showTeam={canCreateTeams({ _id: String(user._id), role: user.role, position: user.position ?? null })}
        isAdmin={user.role === "admin"}
        viewingAs={Boolean(await getImpersonatorId())}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </>
  );
}
