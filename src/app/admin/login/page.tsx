import { redirect } from "next/navigation";
import { getCurrentUser, getImpersonatorId } from "@/lib/auth";
import AdminLoginForm from "@/components/AdminLoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin sign in · TaskTrack", robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  const user = await getCurrentUser();
  if (user?.role === "admin" && !(await getImpersonatorId())) redirect("/admin");
  return <AdminLoginForm signedInAs={user && user.role !== "admin" ? user.name : null} />;
}
