"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { PasswordInput } from "./ui";

/** /admin/login — the admin's own sign-in, separate from the team's. */
export default function AdminLoginForm({ signedInAs }: { signedInAs: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/admin-login", { method: "POST", json: { email, password } });
      // A full load, so the whole site picks up the admin session.
      window.location.href = "/admin";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-fg text-bg" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" strokeLinejoin="round" />
              <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Admin sign in</h1>
            <p className="text-sm text-muted">TaskTrack administration</p>
          </div>
        </div>

        {signedInAs && (
          <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            You&apos;re signed in as {signedInAs}. Signing in here switches this browser to the admin account.
          </p>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="admin-email">Email</label>
            <input id="admin-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" autoFocus />
          </div>
          <div>
            <label className="label" htmlFor="admin-password">Password</label>
            <PasswordInput id="admin-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <button className="btn-primary w-full py-2.5" disabled={busy}>
            {busy ? "Signing in…" : "Sign in to admin"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted">
          Not the admin?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Team sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
