import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canCreateTeams } from "@/lib/constants";
import TeamPageTabs from "@/components/TeamPageTabs";

export const metadata = { title: "Team · TaskTrack" };

/** Teams are for Team Leads and Managers. */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  if (!user || !canCreateTeams({ _id: String(user._id), role: user.role, position: user.position ?? null })) redirect("/tracker");
  const { tab } = await searchParams;
  return (
    <TeamPageTabs
      initialTab={tab === "people" ? "people" : "teams"}
      botUsername={process.env.TELEGRAM_BOT_USERNAME || null}
    />
  );
}
