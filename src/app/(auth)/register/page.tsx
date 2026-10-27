import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import AuthForm from "@/components/AuthForm";

export const metadata = { title: "Create account · TaskTrack" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/tracker");
  return <AuthForm mode="register" googleEnabled={googleEnabled()} />;
}
