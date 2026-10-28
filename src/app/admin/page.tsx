import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canCreateTeams } from "@/lib/constants";
import NavBar from "@/components/NavBar";
import AdminDashboard from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview · TaskTrack" };

/** The admin's private overview. Anyone else is sent to the admin sign-in (/admin/login). */
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/admin/login");

  return (
    <>
      <NavBar
        user={{ _id: String(user._id), name: user.name, presence: user.presence, presenceNote: user.presenceNote ?? null, telegramLinked: Boolean(user.telegramId) }}
        showReports
        showTeam={canCreateTeams({ _id: String(user._id), role: user.role, position: user.position ?? null })}
        isAdmin
      />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <AdminDashboard />
      </main>
    </>
  );
}
