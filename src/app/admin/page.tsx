import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canCreateTeams } from "@/lib/constants";
import NavBar from "@/components/NavBar";
import AdminDashboard from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview · TaskTrack" };

/**
 * The admin's private overview. For anyone else — signed in or not — this page doesn't exist (404).
 * The admin signs in through the normal /login page.
 */
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();

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
