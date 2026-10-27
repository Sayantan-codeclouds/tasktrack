import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import NavBar from "@/components/NavBar";
import { canCreateTeams, canSeeReports } from "@/lib/constants";
import { teamIdsForUser } from "@/lib/teams";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const showReports = canSeeReports({
    _id: String(user._id),
    role: user.role,
    position: user.position ?? null,
    teamIds: await teamIdsForUser(user._id),
  });

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
        showTeam={canCreateTeams({ _id: String(user._id), role: user.role, position: user.position ?? null })}
        isAdmin={user.role === "admin"}
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </>
  );
}
