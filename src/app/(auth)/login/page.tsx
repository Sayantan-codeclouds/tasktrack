import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { googleEnabled } from "@/lib/google";
import AuthForm from "@/components/AuthForm";

export const metadata = { title: "Sign in · TaskTrack" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/tracker");
  const { error } = await searchParams;
  return <AuthForm mode="login" googleEnabled={googleEnabled()} initialError={error} />;
}
