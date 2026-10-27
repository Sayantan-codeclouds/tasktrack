import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canSeeReports } from "@/lib/constants";
import { teamIdsForUser } from "@/lib/teams";
import ReportsView from "@/components/ReportsView";

export const metadata = { title: "Reports · TaskTrack" };

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const actor = { _id: String(user._id), role: user.role, position: user.position ?? null, teamIds: await teamIdsForUser(user._id) };
  if (!canSeeReports(actor)) redirect("/tracker");
  return <ReportsView />;
}
