import Groq from "groq-sdk";
import { z } from "zod";
import { PRESENCE, PRIORITY, TASK_STATUS, type Presence, type TaskStatus } from "../src/lib/constants";

const SetStatus = z.object({
  type: z.literal("set_status"),
  status: z.enum(PRESENCE),
  note: z.string().nullish(),
});
const CreateTask = z.object({
  type: z.literal("create_task"),
  title: z.string().min(2),
  description: z.string().nullish(),
  assignee: z.string().nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  progress: z.number().min(0).max(100).nullish(),
  status: z.enum(TASK_STATUS).nullish(),
  priority: z.enum(PRIORITY).nullish(),
  collaborators: z.array(z.string()).max(10).nullish(),
});
const UpdateTask = z.object({
  type: z.literal("update_task"),
  task: z.string(),
  progress: z.number().min(0).max(100).nullish(),
  status: z.enum(TASK_STATUS).nullish(),
  note: z.string().nullish(),
});
const EodNote = z.object({
  type: z.literal("eod_note"),
  text: z.string().min(2).max(1000),
});
const Action = z.discriminatedUnion("type", [SetStatus, CreateTask, UpdateTask, EodNote]);
export type AiAction = z.infer<typeof Action>;

export interface InterpretInput {
  text: string;
  sender: { name: string; presence: Presence; presenceNote?: string | null };
  /** Tasks the sender can update, keyed by short refs like "T1". */
  tasks: { ref: string; key: string; title: string; status: TaskStatus; progress: number; assignee: string | null }[];
  /** Team members, keyed by short refs like "M1". */
  members: { ref: string; name: string; username: string | null; role: string | null }[];
  /** The task the message is replying to, if any. */
  replyToTaskRef?: string | null;
  replyToText?: string | null;
  now: Date;
  timeZone: string;
}

export interface InterpretResult {
  actions: AiAction[];
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT = `You turn a team member's Telegram group message into updates for a task tracker.
Reply with ONE JSON object and nothing else:
{
  "actions": [ ...zero or more actions... ],
  "confidence": number between 0 and 1 (how sure you are the actions are what the sender meant),
  "reason": short explanation
}

Action types:
1. {"type":"set_status","status":"online"|"break"|"offline","note":string|null}
   - online: starting work, "good morning", "back", "I'm here", resuming after a break.
   - break: lunch, tea/coffee, brb, stepping out, "back in 15".
   - offline: logging off, done for the day, signing off, "bye", leaving.
   - note: short reason or return time if given ("lunch", "back at 3pm"), else null.
   - Do NOT emit set_status if the sender is already in that status, unless the note changes.
   - If the sender is offline/break and clearly talks about doing work right now, also emit online.
2. {"type":"update_task","task":"T#","progress":0-100|null,"status":"todo"|"in_progress"|"blocked"|"done"|null,"note":string|null}
   - Only use refs from the TASKS list. Pick the task the message clearly refers to.
     People may name a ticket by its key in brackets (e.g. "TT-12 done") — map it to that task's T# ref.
   - "almost done" ≈ 90, "halfway" = 50, "just started" ≈ 10, explicit percentages win.
   - finished/completed/done/shipped/merged → status "done".
   - stuck/blocked/waiting on someone → status "blocked" with a note.
   - Keep progress null if no amount is implied.
3. {"type":"create_task","title":string,"description":string|null,"assignee":"M#"|null,"collaborators":["M#",...]|null,"dueDate":"YYYY-MM-DD"|null,"progress":number|null,"status":"todo"|"in_progress"|"blocked"|"done"|null,"priority":"low"|"medium"|"high"|"urgent"|null}
   - status: what the message says about the new ticket — "in progress"/"working on"/"started"/"doing"/"ongoing"/"WIP" → "in_progress";
     "blocked"/"stuck"/"on hold" → "blocked"; "done"/"completed"/"finished" → "done"; "to do"/"pending"/"not started" → "todo".
     Messages like "Task: X — In progress" or "X (in progress)" are a new ticket X with status "in_progress" (the title is just X).
     Null when the message doesn't say.
   - Several people on one ticket ("Priya and Ravi, build the signup page together", "designer + dev on the banner"):
     assignee = the first person named, collaborators = the others. One ticket, not one per person.
   - priority: "urgent"/"ASAP"/"critical"/"blocker" → urgent, "important"/"high priority" → high, "whenever"/"low priority" → low, otherwise null.
   - When someone assigns work ("@ravi please do X", "Priya, take the invoice bug") → assignee is that member's ref.
   - Work can be assigned by role ("designer, please make the banner", "senior dev to review the API"):
     pick the member with that role. If several members share the role, set assignee null and lower confidence.
   - When the sender says they are starting a NEW piece of work that is not in TASKS → assignee null (means the sender).
   - Title: short and imperative ("Build payment API"). Resolve relative dates ("Friday", "tomorrow") using TODAY.

4. {"type":"eod_note","text":string}
   - When the message is the sender's end-of-day / daily status report: starts with "EOD", "end of day", "daily update",
     "wrapping up", or summarises what they did today and/or plan for tomorrow.
   - text: their report, lightly cleaned (keep their wording and ticket keys, drop greetings). Max ~500 characters.
   - Usually combine it with update_task actions for any tickets it clearly mentions, and set_status offline if they're signing off.

Rules:
- Casual chat, questions, jokes, links, thanks, and anything unclear → "actions": [] .
- Never invent task refs or member refs. Never create a task that already exists in TASKS — update it instead.
- One message can produce several actions (e.g. "Finished login, going for lunch" → update_task done + set_status break).
- Lower your confidence when you are guessing which task is meant.`;

let client: Groq | null = null;
function groq() {
  if (!client) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");
    // Fail fast and retry rather than leaving a chat message hanging on a slow request.
    client = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 20_000, maxRetries: 2 });
  }
  return client;
}

export async function interpretMessage(input: InterpretInput): Promise<InterpretResult> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(input.now);

  // A ready-made calendar so "Friday" / "next Monday" / "tomorrow" never needs date arithmetic.
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });
  const calendar = Array.from({ length: 14 }, (_, i) => {
    const parts = Object.fromEntries(dayFmt.formatToParts(new Date(input.now.getTime() + i * 86_400_000)).map((p) => [p.type, p.value]));
    return `${i === 0 ? "today" : i === 1 ? "tomorrow" : parts.weekday} = ${parts.year}-${parts.month}-${parts.day}${i > 1 ? "" : ` (${parts.weekday})`}`;
  });

  const context = [
    `TODAY: ${today} (${input.timeZone})`,
    `CALENDAR (use these exact dates for due dates — "Friday" means the FIRST Friday listed):\n${calendar.join("\n")}`,
    `SENDER: ${input.sender.name} — current status: ${input.sender.presence}${
      input.sender.presenceNote ? ` ("${input.sender.presenceNote}")` : ""
    }`,
    `TASKS:\n${
      input.tasks.length
        ? input.tasks
            .map(
              (t) =>
                `${t.ref}${t.key ? ` (${t.key})` : ""}: "${t.title}" — ${t.status}, ${t.progress}%${t.assignee ? `, assigned to ${t.assignee}` : ""}`,
            )
            .join("\n")
        : "(none)"
    }`,
    `MEMBERS:\n${input.members
      .map((m) => `${m.ref}: ${m.name}${m.username ? ` (@${m.username})` : ""}${m.role ? ` — ${m.role}` : ""}`)
      .join("\n")}`,
    input.replyToTaskRef ? `The message is a REPLY about task ${input.replyToTaskRef}.` : null,
    input.replyToText ? `It replies to this message: "${input.replyToText.slice(0, 300)}"` : null,
    `MESSAGE:\n${input.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const completion = await groq().chat.completions.create({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: context },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { actions: [], confidence: 0, reason: "Model returned invalid JSON" };
  }

  // Keep the valid actions even if the model got one of them wrong.
  const actions = (Array.isArray(parsed.actions) ? parsed.actions : [])
    .map((a) => Action.safeParse(a))
    .filter((r) => r.success)
    .map((r) => r.data);

  const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  return { actions, confidence, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
}
