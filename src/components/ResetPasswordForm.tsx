"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { PasswordInput, TelegramIcon } from "./ui";

/** The page the bot's /forgotpass link opens. `token` is null when the link is bad or expired. */
export default function ResetPasswordForm({ token, botUsername }: { token: string | null; botUsername: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ telegramLinked: boolean }>("/api/auth/reset", {
        method: "POST",
        json: { token, password, confirmPassword: confirm },
      });
      router.replace(res.telegramLinked ? "/tracker" : "/profile?connect=telegram");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white shadow-lg shadow-accent/30">
          <TelegramIcon className="h-5 w-5" />
        </div>

        {token ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
            <p className="mt-1.5 text-sm text-muted">You&apos;ll be signed in straight after — and signed out everywhere else.</p>
            <form onSubmit={submit} className="mt-8 space-y-4">
              <div>
                <label className="label" htmlFor="password">New password</label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  autoFocus
                />
              </div>
              <div>
                <label className="label" htmlFor="confirm">Confirm password</label>
                <PasswordInput
                  id="confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder="Type it again"
                  aria-invalid={mismatch}
                  className={mismatch ? "border-danger focus:border-danger focus:ring-danger/20" : ""}
                />
                {mismatch && <p className="mt-1 text-[11px] text-danger">Passwords don&apos;t match</p>}
              </div>
              {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
              <button className="btn-primary w-full py-2.5" disabled={busy || mismatch}>
                {busy ? "Saving…" : "Save password and sign in"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">This link has expired</h1>
            <p className="mt-1.5 text-sm text-muted">
              Reset links work once, for 30 minutes. Send <code className="rounded bg-surface-2 px-1 font-semibold text-fg">/forgotpass</code> to{" "}
              {botUsername ? (
                <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                  @{botUsername}
                </a>
              ) : (
                "the bot"
              )}{" "}
              in Telegram for a new one.
            </p>
          </>
        )}

        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/login" className="font-medium text-accent hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
