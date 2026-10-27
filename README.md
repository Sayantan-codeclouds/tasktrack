# TaskTrack

A team task tracker that updates itself from your Telegram group. People chat normally ("lunch, back in 30", "login page is 80% done", "@ravi please build the payment API by Friday"). A Groq LLM reads each message and updates statuses, tasks and progress on the tracker. Every change is recorded in an activity log.

**Stack:** Next.js 16 (App Router) · MongoDB (Mongoose) · Node Telegram bot (grammY) · Groq · Tailwind CSS v4

## What's in the app

After signing in there are these pages:

| Page | What it shows |
|---|---|
| **Reports** (`/reports`), Team Leads (their teams), Managers and admin | **EOD** (one day) and **EOW** (Mon–Sun) report per team, with the team's shift, lead and manager. Three tabs: **Overview** (totals, people, EOD notes, who hasn't posted one) · **Tickets day by day** (each ticket's progress at the end of every day, highlighted on days it changed, with the faces of whoever worked on it) · **People day by day** (per person, per day: first online, ⏰ late vs. shift, online/break time, and everything they did, in time order). **Download** as CSV, text or PDF, any date or week · **Post to group** |
| **Team** (`/team`) | **Teams tab:** create teams, connect each one's Telegram group, see members by role (Team Lead, Developers, Designers) and who's waiting to link · **People & roles tab:** everyone grouped by role (Management, Team Leads, Developers, Designers, No role yet) with live status, Telegram link, and open/completed tickets · Role dropdown on each card for people allowed to assign roles · Emails visible to Managers and above |
| **Activity** (`/activity`) | The full activity log: every status change, task update, link and login, grouped by day with exact times · Filter by date range (today / 7 days / 30 days / all / custom), person, activity type and source · Search the text, including the original Telegram messages · Live updates · **Export CSV** of whatever is filtered |
| **Tracker** (`/tracker`) | **Ticket board** (To do → In progress → Blocked → Done). Every task is a ticket with a key (`TT-12`), a priority (Low / Medium / High / Urgent), an assignee, a due date and progress. **Drag a ticket to another column** to change its status; it's logged like any other update. Team strip with live status · Stats · Search, priority filter, "My tickets" · Slide-out live activity drawer |
| **Profile** (`/profile`) | Your details and task stats · Link or unlink Telegram · Change name and password · Your own activity log |

Click a team member to filter tasks to that person. Click a task to edit it and see its history. You can also set your status from the avatar menu in the top bar.

### Teams, leads and shifts

- **Creating teams:**
  - **Team Leads** can create a team. They lead it and pick the **Manager** who oversees it.
  - **Managers** can create a team and pick its **Team Lead**.
- **Running a team:** the team's Team Lead, its overseeing Manager, any Manager, and admin can all run it. That covers the Telegram group, members, shift and EOD posts.
- **Changing the lead:** only Managers can change who leads a team.
- **Shift timings:** the Team Lead sets the start and end, e.g. 10:00–19:00.
  - The bot posts that team's EOD at the shift end.
  - The tracker shows "On shift" or "Off shift".
  - Reports flag anyone who came online more than 10 minutes after the shift start.
- **Shared tickets:** a ticket has one assignee plus any number of people **working on it too**, such as a designer and a developer.
  - Everyone on a ticket can update it, and it counts as open work for each of them.
  - In Telegram, "Jay and Dia, build the checkout page together" creates one shared ticket.

### Roles and permissions

The first account registered becomes **admin** (the account owner). Everyone else starts with no role until a manager assigns one on the **Team** page.

| Role | Tickets | Assigning roles |
|---|---|---|
| **Admin** | Edit, move, delete any | Anyone, any role (including their own) |
| **Senior Manager**, **Manager** | Edit, move, delete any | Only people ranked below them, only to roles below their own |
| **Team Lead** | Edit and move tickets of **their own teams** (plus tickets without a team). Create teams; run the ones they lead | — |
| **Senior / Junior Developer**, **Senior / Junior Designer** | Their own (assigned to them or created by them) | — |

Role changes are recorded in the activity log. The AI knows everyone's role, so "designer, please make the banner" in Telegram assigns it to the designer. If several people share that role, the AI doesn't pick one at random: it lowers its confidence and leaves the ticket unassigned.

## How it works

```
Telegram group ──► bot (npm run bot) ──► Groq: "what does this message mean?" ──► JSON actions
                                                                                     │
                     Next.js app (npm run dev) ◄── MongoDB ◄── services.ts ◄──────────┘
                     tracker polls every 5 s          (users, tasks, activity logs)
```

- [`bot/index.ts`](bot/index.ts) reads every message from linked users. Context goes to the AI with each message: the sender's current status, their open tasks, tasks they've assigned to others, the team list, and the task being replied to.
- [`bot/ai.ts`](bot/ai.ts) asks Groq for strict JSON with these actions: `set_status`, `update_task` and `create_task`, plus a confidence score. Actions below `AI_MIN_CONFIDENCE` are skipped, and the bot reacts 🤔.
- [`src/lib/services.ts`](src/lib/services.ts) is the only place data changes. The bot and the web app both call it, so every change writes an activity log entry. Entries from Telegram also store the original message and the AI's confidence.
- **Replying to a task message:** replies to the original task message, or to the bot's 🆕 confirmation, are tied to that task, so "done ✅" as a reply works.
- **Auto-offline:** anyone silent for `AUTO_OFFLINE_MINUTES` is marked offline.

## Setup

### 1. Prerequisites

- Node.js 20+
- MongoDB: install locally, or create a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas)
- A Groq API key: <https://console.groq.com/keys>

### 2. Create the Telegram bot

1. Message **@BotFather** → `/newbot` → pick a name and username → copy the **token**.
2. In @BotFather: `/setprivacy` → choose your bot → **Disable**. Without this, the bot only sees commands, not normal chat.
3. Groups are connected to teams from the website. See [step 5](#5-set-up-teams-and-onboard-people).

> If you added the bot to a group *before* disabling privacy mode, remove it and add it again so the change takes effect.

### 3. Configure

```bash
npm install
cp .env.example .env.local   # then fill in the values
```

| Variable | Notes |
|---|---|
| `MONGODB_URI` | e.g. `mongodb://127.0.0.1:27017/tasktrack` or your Atlas URI |
| `JWT_SECRET` | Long random string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `ALLOW_REGISTRATION` | `false` closes sign-ups after the first account |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_BOT_USERNAME` | Without `@`; shown as a link on the Profile page |
| `GROQ_API_KEY` / `GROQ_MODEL` | Default model: `openai/gpt-oss-120b`. See which models your key can use at <https://console.groq.com/docs/models> |
| `AI_MIN_CONFIDENCE` | Default `0.6` |
| `AUTO_OFFLINE_MINUTES` | Default `240`; `0` disables it |
| `APP_TIMEZONE` | Lets the AI resolve "tomorrow" or "Friday", and sets where a day starts and ends for reports, e.g. `Asia/Kolkata` |
| `REPORT_EOD_TIME` · `REPORT_WORK_DAYS` · `REPORT_EOW_DAY` | When the bot posts EOD and EOW into each team's group. Defaults: 19:00, Mon–Fri, Friday. Managers can switch posting off per team on the Team page. |

### Optional: Google sign-in

Adds **Continue with Google** to the sign-in and sign-up pages. Any Google account works, and `ALLOW_REGISTRATION` still applies to new people.

1. [Google Cloud Console](https://console.cloud.google.com/) → create (or pick) a project.
2. **APIs & Services → OAuth consent screen**:
   - User type **External**.
   - Fill in the app name and a support email.
   - Scopes: just the defaults (`openid`, `email`, `profile`).
   - Then **Publish app**. While it's in "Testing", only the test users you list can sign in. These basic scopes don't need Google's review.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Type **Web application**.
   - Authorized redirect URI: `http://localhost:3000/api/auth/google/callback`. Add your production URL's `/api/auth/google/callback` too when you deploy.
4. Put the values in `.env.local` and restart `npm run dev`:
   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   APP_URL=http://localhost:3000
   ```

**How accounts are matched:**
- Someone who already has an account with the same (verified) email is linked to it.
- Otherwise a new account is created. The very first account becomes admin.
- Google-only users can set a password later on their Profile page.

### 4. Run

Use two terminals:

```bash
npm run dev       # web app → http://localhost:3000
npm run bot:dev   # Telegram bot (restarts on file changes)
```

### 5. Set up teams and onboard people

Each team (e.g. POD5) has **its own Telegram group**. The group decides who is in the team.

**A Manager, once per team:**
1. **Team → Teams → New team**, e.g. "POD5".
2. Add the bot to that team's Telegram group and **make it an admin**. Admin lets it see every join and leave, and delete used `/link` codes.
3. On the team card, click **Connect Telegram group** and send the `/link CODE` it shows **inside the group**.

**From then on, membership syncs by itself:**
- Add someone to the group → they join the team on the site.
- Remove them, or they leave → they leave the team.
- People already in the group are added the first time they send a message.
- Someone who joins before having a tracker account is listed as **Waiting to link**. They join automatically once they link.
- If the group is upgraded to a supergroup, the connection follows. If the bot is removed from the group, the team is disconnected.

**Each person, once:** create an account → **Profile → Link Telegram** → send `/link CODE` to the bot, privately or in their team's group. It's the same command as for teams: the bot tells person codes and team codes apart.

**Inside a team's group:**
- Tickets created there belong to that team.
- The AI only assigns work to that team's members.
- Status updates are logged under the team.

Groups that aren't connected to a team are ignored, apart from `/link` and `/help`.

Managers can also add or remove people on the team card. This is a fallback; the Telegram group stays the source of truth.

## Bot commands

People can just talk. These commands are there when someone wants to be exact:

| Command | Does |
|---|---|
| `/online [note]` `/break [note]` `/offline [note]` | Set status |
| `/tasks` | List your open tasks with numbers |
| `/progress <#> <percent> [note]` | e.g. `/progress 2 80 tests left` |
| `/done <#>` | Mark task done |
| `/new <title>` | Create a task for yourself |
| `/link <CODE>` | Link your tracker account (person code), or connect this group to a team (team code) |
| `/eod <text>` | Your end-of-day update. Starting a normal message with "EOD:" works too; the AI picks it up. |
| `/report` · `/report week` | This team's EOD / EOW summary, posted in the group |
| `/chatid` · `/help` | Utilities |

## Troubleshooting

- **AI requests time out (`APIConnectionTimeoutError`) while `curl` to api.groq.com works:** some firewalls and antivirus web filters drop the larger post-quantum TLS handshake that Node 24 sends. [`bot/env.ts`](bot/env.ts) already limits the bot to the classic key-exchange groups to avoid this. Set `TLS_ECDH_CURVE=auto` to restore Node's default.
- **Bot ignores normal messages:** privacy mode is still on. Use `/setprivacy` → Disable in @BotFather, then remove the bot from the group and add it back.
- **`409 Conflict` from the bot:** two copies are running. Stop one.

## Deploy on Render

Everything runs on **one free Web Service**. The bot lives inside the website:
- **Messages:** Telegram delivers each one to `/api/telegram/webhook` (a "webhook").
- **Scheduled work:** a free external scheduler calls `/api/cron` every few minutes. That posts EOD/EOW reports, marks idle people offline, and keeps the free instance awake.

[`render.yaml`](render.yaml) describes the service. You can use it as a Blueprint, or set the service up by hand:

1. **MongoDB Atlas:** go to Network Access → Add IP Address → **Allow access from anywhere** (`0.0.0.0/0`). Render's outgoing IP addresses change.
2. **Render:** New → **Web Service** → connect this repo.
   - Runtime: **Node**
   - Build command: `npm ci && npm run build`
   - Start command: `npm start`
   - Instance type: **Free**
3. **Environment variables:**
   - Secrets you provide: `MONGODB_URI`, `TELEGRAM_BOT_TOKEN`, `GROQ_API_KEY`, `ADMIN_EMAILS`, `TELEGRAM_BOT_USERNAME`
   - `APP_URL`: the site's address, e.g. `https://tasktrack-web.onrender.com`
   - Three long random strings: `JWT_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`
   - Settings: `APP_TIMEZONE=Asia/Kolkata`, `NODE_VERSION=22`
4. **Scheduler:** at [cron-job.org](https://cron-job.org) (free), create a job that calls `https://<your-site>/api/cron?key=<CRON_SECRET>` **every 5 minutes**.
   - The first call registers the webhook with Telegram.
   - Opening that URL yourself shows the result, e.g. `"webhook": "registered"`.
5. **Don't run `npm run bot` against the same bot token.** It refuses to start while the live site holds the webhook. For local development, use a separate test bot.

If you'd rather run the bot as its own always-on Background Worker (Render Starter plan), use `npm run bot` as the worker's start command and leave `TELEGRAM_WEBHOOK_SECRET` unset on the web service.

## Production

```bash
npm run build && npm start   # web app
npm run bot                  # bot: run it as a separate always-on process
```

The bot uses long polling, so it needs a process that stays running: a VPS with `pm2`, Railway, Render background worker, Fly.io, and so on. The web app can run anywhere Next.js runs, including Vercel. Run **one** bot instance only. Telegram rejects two pollers on the same token.

## Project layout

```
bot/
  index.ts        Telegram bot: commands, account linking, AI message handling, auto-offline
  ai.ts           Groq prompt + validated JSON output
src/lib/
  services.ts     All data changes + activity logging (shared by bot and web)
  models/         User, Task, ActivityLog
  auth.ts         JWT session cookie, bcrypt passwords
src/app/
  (auth)/         /login, /register
  (app)/          /tracker, /profile (require sign-in)
  api/            auth, tracker, tasks, logs, me (profile, presence, telegram link)
src/components/   TrackerView, ProfileView, ActivityLog, TaskModal, NavBar, ui
```
