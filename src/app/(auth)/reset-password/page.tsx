import { resetTokenValid } from "@/lib/passwordReset";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export const metadata = { title: "Reset password · TaskTrack" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const valid = Boolean(token) && (await resetTokenValid(token!));
  return <ResetPasswordForm token={valid ? token! : null} botUsername={process.env.TELEGRAM_BOT_USERNAME || null} />;
}
