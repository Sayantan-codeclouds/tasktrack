"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, duration, emitRefresh, reloadAvatars, timeAgo, useAvatarVersion, usePolling } from "@/lib/client";
import { POSITION_LABEL, type Position, type Presence } from "@/lib/constants";
import ActivityLog from "./ActivityLog";
import { Avatar, PasswordInput, PositionBadge, PresenceBadge, Spinner, TelegramIcon } from "./ui";

interface ProfileData {
  user: {
    _id: string;
    name: string;
    email: string;
    role: "admin" | "member";
    position: Position | null;
    requestedPosition: Position | null;
    presence: Presence;
    presenceNote: string | null;
    presenceSince: string;
    lastSeenAt: string | null;
    telegramId: string | null;
    telegramUsername: string | null;
    linkCode: string | null;
    linkCodeExpires: string | null;
    createdAt: string;
    hasPassword: boolean;
    googleLinked: boolean;
  };
  stats: { total: number; done: number; open: number; avgOpenProgress: number };
  teams: { _id: string; name: string; color: string; telegramChatTitle: string | null }[];
  botUsername: string | null;
}

export default function ProfileView() {
  const router = useRouter();
  const { data, reload } = usePolling<ProfileData>("/api/me", 15000);
  // Sign-in sends people without Telegram here with ?connect=telegram: walk them through linking it.
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("connect") === "telegram") setConnecting(true);
  }, []);
  const closeConnect = () => {
    setConnecting(false);
    window.history.replaceState(null, "", "/profile");
  };

  // While a link code is showing, check often so the page flips to "linked" right away.
  const waitingForLink = Boolean(data?.user.linkCode && !data.user.telegramId);
  useEffect(() => {
    if (!waitingForLink) return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [waitingForLink, reload]);

  // Refresh the server-rendered nav bar when the link state changes.
  const linked = data ? Boolean(data.user.telegramId) : null;
  const prevLinked = useRef(linked);
  useEffect(() => {
    if (prevLinked.current !== null && linked !== null && linked !== prevLinked.current) router.refresh();
    prevLinked.current = linked;
  }, [linked, router]);

  if (!data) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const { user, stats } = data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <section className="card flex flex-wrap items-center gap-4 p-5">
            <PhotoPicker userId={user._id} name={user.name} presence={user.presence} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold">{user.name}</h2>
                <PositionBadge position={user.position} admin={user.role === "admin"} />
                {user.requestedPosition && (
                  <span className="rounded-md bg-break/12 px-2 py-0.5 text-xs font-medium text-break">
                    ⏳ {POSITION_LABEL[user.requestedPosition]} — waiting for a manager to approve
                  </span>
                )}
              </div>
              <p className="truncate text-sm text-muted">{user.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <PresenceBadge presence={user.presence} />
                <span>for {duration(user.presenceSince)}</span>
                {user.presenceNote && <span className="italic">“{user.presenceNote}”</span>}
                <span>· joined {new Date(user.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                {data.teams.length ? (
                  data.teams.map((t) => (
                    <a
                      key={t._id}
                      href={`/tracker?team=${t._id}`}
                      className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 font-medium hover:border-accent/50"
                      title={t.telegramChatTitle ? `Telegram: ${t.telegramChatTitle}` : undefined}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                      {t.name}
                    </a>
                  ))
                ) : (
                  <span className="text-muted">Not in a team yet — you'll join one when you're added to its Telegram group.</span>
                )}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Open tasks" value={stats.open} />
            <Stat label="Completed" value={stats.done} tone="text-online" />
            <Stat label="Total assigned" value={stats.total} />
            <Stat label="Avg. progress (open)" value={`${stats.avgOpenProgress}%`} tone="text-accent" />
          </div>

          <TelegramCard data={data} onChange={reload} />

          <div className="grid gap-6 md:grid-cols-2">
            <NameForm name={user.name} onSaved={() => (reload(), router.refresh(), emitRefresh())} />
            <PasswordForm hasPassword={user.hasPassword} googleLinked={user.googleLinked} onSaved={reload} />
          </div>
        </div>

        <ActivityLog title="My activity" userId={user._id} className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]" />
      </div>

      {connecting && <ConnectTelegramModal data={data} onChange={reload} onClose={closeConnect} />}
    </div>
  );
}

/** Shown after sign-in to anyone not on Telegram yet: one tap on "Open Telegram" → Start links the account. */
function ConnectTelegramModal({ data, onChange, onClose }: { data: ProfileData; onChange: () => void; onClose: () => void }) {
  const { user, botUsername } = data;
  const linked = Boolean(user.telegramId);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const asking = useRef(false);

  // Get a link code as soon as the dialog opens, and a fresh one if it expires (15 min) while it's open.
  // The page checks every few seconds whether they've linked.
  useEffect(() => {
    if (linked || user.linkCode || asking.current || err) return;
    asking.current = true;
    api("/api/me/telegram", { method: "POST" })
      .then(onChange)
      .catch((e) => setErr((e as Error).message))
      .finally(() => (asking.current = false));
  }, [linked, user.linkCode, err, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startLink = botUsername && user.linkCode ? `https://t.me/${botUsername}?start=link_${user.linkCode}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="connect-tg-title" className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <span className={`flex h-12 w-12 items-center justify-center rounded-2xl text-white ${linked ? "bg-online" : "bg-accent"}`}>
          <TelegramIcon className="h-6 w-6" />
        </span>

        {linked ? (
          <>
            <h2 id="connect-tg-title" className="mt-4 text-lg font-semibold">
              Telegram connected ✓
            </h2>
            <p className="mt-1 text-sm text-muted">
              You&apos;re linked{user.telegramUsername ? ` as @${user.telegramUsername}` : ""}. Your messages in the team group now update your tasks and status, and EOD
              reminders will reach you there.
            </p>
            <button className="btn-primary mt-5 w-full" onClick={onClose} autoFocus>
              Done
            </button>
          </>
        ) : (
          <>
            <h2 id="connect-tg-title" className="mt-4 text-lg font-semibold">
              Connect your Telegram
            </h2>
            <p className="mt-1 text-sm text-muted">
              The team works through its Telegram group — your messages there update your tasks and status, and EOD reminders come there. Link it once:
            </p>

            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex gap-3">
                <Step n={1} />
                <div className="min-w-0 flex-1">
                  <p>Open the bot in Telegram:</p>
                  {startLink ? (
                    <a href={startLink} target="_blank" rel="noreferrer" className="btn-primary mt-2 w-full">
                      <TelegramIcon className="h-4 w-4" /> Open Telegram
                    </a>
                  ) : (
                    <p className="mt-1 flex items-center gap-2 text-muted">
                      <Spinner className="h-3 w-3" /> Getting your link…
                    </p>
                  )}
                </div>
              </li>
              <li className="flex gap-3">
                <Step n={2} />
                <p className="pt-0.5">
                  Tap <strong>Start</strong> at the bottom of the chat. That&apos;s it — this page updates by itself.
                </p>
              </li>
            </ol>

            {user.linkCode && (
              <div className="mt-5 rounded-lg bg-surface-2 p-3 text-xs text-muted">
                No Start button, or Telegram is on another device? Send this to {botUsername ? `@${botUsername}` : "the bot"}:
                <div className="mt-2 flex items-center gap-2">
                  <code className="rounded-md bg-surface px-2.5 py-1 font-mono text-sm font-semibold tracking-wider text-fg">/link {user.linkCode}</code>
                  <button
                    className="text-accent hover:underline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(`/link ${user.linkCode}`).catch(() => {});
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              </div>
            )}
            {err && <p className="mt-3 text-sm text-danger">{err}</p>}

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xs text-muted">
                {user.linkCode && (
                  <>
                    <Spinner className="h-3 w-3" /> Waiting for Telegram…
                  </>
                )}
              </p>
              <button className="btn-ghost" onClick={onClose}>
                Later
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{n}</span>;
}

const PHOTO_PX = 256;

/** Centre-crop to a square and shrink, so uploads are small (~20–40 KB) whatever the camera made. */
async function squarePhoto(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PHOTO_PX;
  const g = canvas.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
  img.close();
  const encode = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.86));
  // Browsers that can't write WebP hand back PNG instead — use JPEG then.
  const webp = await encode("image/webp");
  const blob = webp?.type === "image/webp" ? webp : await encode("image/jpeg");
  if (!blob) throw new Error("Couldn't process that image");
  return blob;
}

function PhotoPicker({ userId, name, presence }: { userId: string; name: string; presence: Presence }) {
  const hasPhoto = useAvatarVersion(userId) !== undefined;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      let blob: Blob;
      try {
        blob = await squarePhoto(file);
      } catch {
        throw new Error("Couldn't read that image — try a JPEG or PNG");
      }
      const form = new FormData();
      form.set("photo", blob, "photo");
      const res = await fetch("/api/me/avatar", { method: "PUT", body: form });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed");
      await reloadAvatars();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove your photo? Your initials will show instead.")) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/me/avatar", { method: "DELETE" });
      await reloadAvatars();
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="group relative rounded-full focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        aria-label={hasPhoto ? "Change photo" : "Add a photo"}
        title={hasPhoto ? "Change photo" : "Add a photo"}
      >
        <Avatar name={name} id={userId} size={64} presence={presence} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          )}
        </span>
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="hidden" onChange={pick} />
      <div className="flex gap-2 text-[11px]">
        <button type="button" className="font-medium text-accent hover:underline disabled:opacity-50" onClick={() => input.current?.click()} disabled={busy}>
          {hasPhoto ? "Change" : "Add photo"}
        </button>
        {hasPhoto && (
          <button type="button" className="text-muted hover:text-danger disabled:opacity-50" onClick={remove} disabled={busy}>
            Remove
          </button>
        )}
      </div>
      {err && <p className="max-w-40 text-center text-[11px] text-danger">{err}</p>}
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function TelegramCard({ data, onChange }: { data: ProfileData; onChange: () => void }) {
  const { user, botUsername } = data;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const linked = Boolean(user.telegramId);

  async function generate() {
    setBusy(true);
    try {
      await api("/api/me/telegram", { method: "POST" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!confirm("Unlink your Telegram? Your messages will stop updating the tracker.")) return;
    setBusy(true);
    try {
      await api("/api/me/telegram", { method: "DELETE" });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${linked ? "bg-accent text-white" : "bg-surface-2 text-muted"}`}>
          <TelegramIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Telegram</h3>
          {linked ? (
            <p className="mt-0.5 text-sm text-muted">
              Linked{user.telegramUsername ? <> as <span className="font-medium text-fg">@{user.telegramUsername}</span></> : ""}. Your messages in the team group update your status and tasks
              {user.lastSeenAt ? <> · last message {timeAgo(user.lastSeenAt)}</> : ""}.
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-muted">
              Link your Telegram account so the bot knows which messages are yours.
            </p>
          )}
        </div>
        {linked ? (
          <button onClick={unlink} className="btn-ghost shrink-0" disabled={busy}>
            Unlink
          </button>
        ) : (
          !user.linkCode && (
            <button onClick={generate} className="btn-primary shrink-0" disabled={busy}>
              {busy && <Spinner />} Link Telegram
            </button>
          )
        )}
      </div>

      {!linked && user.linkCode && (
        <div className="mt-4 rounded-lg border border-dashed border-accent/50 bg-accent-soft/50 p-4">
          <p className="text-sm">
            Send this to {botUsername ? (
              <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                @{botUsername}
              </a>
            ) : (
              "the bot"
            )}{" "}
            in a private chat or in your team group:
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="rounded-lg bg-surface px-4 py-2 font-mono text-xl font-semibold tracking-widest">
              /link {user.linkCode}
            </code>
            <button onClick={() => copy(`/link ${user.linkCode}`)} className="btn-ghost">
              {copied ? "Copied ✓" : "Copy"}
            </button>
            {botUsername && (
              <a href={`https://t.me/${botUsername}?start=link_${user.linkCode}`} target="_blank" rel="noreferrer" className="btn-primary">
                <TelegramIcon className="h-4 w-4" /> Open Telegram
              </a>
            )}
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Spinner className="h-3 w-3" /> Waiting for you to send it… The code expires{" "}
            {user.linkCodeExpires && new Date(user.linkCodeExpires).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.
            <button onClick={generate} className="text-accent hover:underline" disabled={busy}>
              New code
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

function NameForm({ name, onSaved }: { name: string; onSaved: () => void }) {
  const [value, setValue] = useState(name);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(name), [name]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/me", { method: "PATCH", json: { name: value } });
      setMsg({ ok: true, text: "Saved" });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      <h3 className="font-semibold">Display name</h3>
      <div>
        <label className="label" htmlFor="p-name">Name shown to your team</label>
        <input id="p-name" className="input" value={value} onChange={(e) => setValue(e.target.value)} required minLength={2} />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy || value.trim() === name}>
          {busy && <Spinner />} Save
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-online" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

function PasswordForm({ hasPassword, googleLinked, onSaved }: { hasPassword: boolean; googleLinked: boolean; onSaved: () => void }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setMsg({ ok: false, text: "Passwords don't match" });
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/me", {
        method: "PATCH",
        json: { currentPassword: form.currentPassword || undefined, newPassword: form.newPassword },
      });
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setMsg({ ok: true, text: hasPassword ? "Password changed" : "Password set — you can now also sign in with email" });
      onSaved();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={save} className="card space-y-4 p-5">
      <div>
        <h3 className="font-semibold">{hasPassword ? "Change password" : "Set a password"}</h3>
        {googleLinked && (
          <p className="mt-0.5 text-xs text-muted">
            {hasPassword ? "You can sign in with Google or with your email and password." : "You sign in with Google. Set a password to also sign in with email."}
          </p>
        )}
      </div>
      {hasPassword && (
        <div>
          <label className="label" htmlFor="p-cur">Current password</label>
          <PasswordInput id="p-cur" value={form.currentPassword} onChange={set("currentPassword")} required autoComplete="current-password" />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="p-new">New password</label>
          <PasswordInput id="p-new" value={form.newPassword} onChange={set("newPassword")} required minLength={8} autoComplete="new-password" />
        </div>
        <div>
          <label className="label" htmlFor="p-confirm">Confirm</label>
          <PasswordInput id="p-confirm" value={form.confirm} onChange={set("confirm")} required minLength={8} autoComplete="new-password" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy}>
          {busy && <Spinner />} Update password
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-online" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
