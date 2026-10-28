"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { PasswordInput, Spinner, TelegramIcon } from "./ui";
import { POSITION_LABEL, isSelfServeRole, type Position } from "@/lib/constants";

const ROLE_GROUPS: { label: string; roles: Position[] }[] = [
  { label: "Development", roles: ["junior_developer", "senior_developer"] },
  { label: "Design", roles: ["junior_designer", "senior_designer"] },
  { label: "Leadership", roles: ["team_lead", "manager", "senior_manager"] },
];

const GOOGLE_ERRORS: Record<string, string> = {
  google_off: "Google sign-in isn't set up yet.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "That sign-in link expired — please try again.",
  google_failed: "Couldn't sign in with Google — please try again.",
  google_unverified: "Your Google email isn't verified.",
  registration_closed: "Registration is closed. Ask your manager to create your account first.",
  blocked: "This account can't sign in to TaskTrack.",
};

function GoogleIcon() {
  // Google's multicolour "G", per their sign-in branding guidelines.
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Rough strength hint: length plus variety of character types. */
function strength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: "" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < 8) return { score: 1, label: "Too short" };
  if (pw.length >= 12 && kinds >= 3) return { score: 3, label: "Strong" };
  if (kinds >= 2) return { score: 2, label: "Good" };
  return { score: 1, label: "Weak — mix letters, numbers or symbols" };
}

const FEATURES = [
  ["💬", "Your team just chats in Telegram — the AI keeps the tracker up to date."],
  ["🎫", "Tickets on a drag-and-drop board, per team, with shifts."],
  ["📋", "EOD & EOW reports posted automatically, downloadable any time."],
];

export default function AuthForm({
  mode,
  googleEnabled = false,
  initialError,
}: {
  mode: "login" | "register";
  googleEnabled?: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", position: "" });
  const needsApproval = Boolean(form.position) && !isSelfServeRole(form.position as Position);
  const [error, setError] = useState<string | null>(initialError ? (GOOGLE_ERRORS[initialError] ?? "Sign-in failed.") : null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";
  const mismatch = isRegister && form.confirm.length > 0 && form.confirm !== form.password;
  const pw = strength(form.password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isRegister && form.password !== form.confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ telegramLinked?: boolean }>(`/api/auth/${mode}`, {
        method: "POST",
        json: isRegister
          ? { name: form.name, email: form.email, password: form.password, confirmPassword: form.confirm, position: form.position || undefined }
          : { email: form.email, password: form.password },
      });
      // Not on Telegram yet → Profile, which walks them through linking it.
      router.replace(res.telegramLinked ? "/tracker" : "/profile?connect=telegram");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="hero-panel relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 text-lg font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <TelegramIcon className="h-5 w-5" />
          </span>
          TaskTrack
        </div>
        <div className="my-auto max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">Your team’s day, tracked from the chat.</h2>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(([icon, text]) => (
              <li key={text} className="flex gap-3 text-[15px] text-white/85">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/12 text-base">{icon}</span>
                <span className="pt-1">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/60">Built for teams that live in Telegram.</p>
      </section>

      {/* Form */}
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white shadow-lg shadow-accent/30 lg:hidden">
              <TelegramIcon className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{isRegister ? "Create your account" : "Welcome back"}</h1>
            <p className="mt-1.5 text-sm text-muted">
              {isRegister ? "Then link your Telegram to start tracking." : "Sign in to see your team’s live board."}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {googleEnabled && (
              <>
                <a href="/api/auth/google" className="btn-ghost w-full py-2.5">
                  <GoogleIcon />
                  Continue with Google
                </a>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-line" />
                  or with email
                  <span className="h-px flex-1 bg-line" />
                </div>
              </>
            )}
            {isRegister && (
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input id="name" className="input" value={form.name} onChange={set("name")} required autoComplete="name" placeholder="Your full name" />
              </div>
            )}
            {isRegister && (
              <div>
                <label className="label" htmlFor="position">Your role</label>
                <select id="position" className="input" value={form.position} onChange={set("position")} required>
                  <option value="" disabled>
                    Choose your role…
                  </option>
                  {ROLE_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.roles.map((p) => (
                        <option key={p} value={p}>
                          {POSITION_LABEL[p]}
                          {isSelfServeRole(p) ? "" : " — needs approval"}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {needsApproval && (
                  <p className="mt-1.5 rounded-lg bg-break/10 px-2.5 py-1.5 text-[11px] text-fg/80">
                    A manager will confirm this. Until then you'll have no role — you can still sign in and use the tracker.
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={form.email} onChange={set("email")} required autoComplete="email" placeholder="you@company.com" />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <PasswordInput
                id="password"
                value={form.password}
                onChange={set("password")}
                required
                minLength={isRegister ? 8 : undefined}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder={isRegister ? "At least 8 characters" : "••••••••"}
              />
              {isRegister && form.password && (
                <div className="mt-1.5 flex items-center gap-2" aria-live="polite">
                  <div className="flex flex-1 gap-1" aria-hidden>
                    {[1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className={`h-1 flex-1 rounded-full ${i <= pw.score ? (pw.score === 1 ? "bg-danger" : pw.score === 2 ? "bg-break" : "bg-online") : "bg-surface-2"}`}
                      />
                    ))}
                  </div>
                  <span className="text-[11px] text-muted">{pw.label}</span>
                </div>
              )}
            </div>
            {isRegister && (
              <div>
                <label className="label" htmlFor="confirm">Confirm password</label>
                <PasswordInput
                  id="confirm"
                  value={form.confirm}
                  onChange={set("confirm")}
                  required
                  autoComplete="new-password"
                  placeholder="Type it again"
                  aria-invalid={mismatch}
                  aria-describedby="confirm-hint"
                  className={mismatch ? "border-danger focus:border-danger focus:ring-danger/20" : ""}
                />
                <p id="confirm-hint" className={`mt-1 text-[11px] ${mismatch ? "text-danger" : "text-online"}`} aria-live="polite">
                  {mismatch ? "Passwords don't match" : form.confirm && form.confirm === form.password ? "✓ Passwords match" : ""}
                </p>
              </div>
            )}
            {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <button className="btn-primary w-full py-2.5" disabled={busy || mismatch}>
              {busy && <Spinner />}
              {isRegister ? "Create account" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {isRegister ? "Already have an account? " : "New to the team? "}
            <Link href={isRegister ? "/login" : "/register"} className="font-medium text-accent hover:underline">
              {isRegister ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
