import { Schema, deleteModel, model, models, type Model, type Types } from "mongoose";
import { PRIORITY, SOURCES, TASK_STATUS, type Priority, type Source, type TaskStatus } from "../constants";

export interface ITask {
  _id: Types.ObjectId;
  /** Sequential ticket number, shown as TT-<number>. */
  number?: number | null;
  title: string;
  description?: string | null;
  team?: Types.ObjectId | null;
  assignee?: Types.ObjectId | null;
  /** Others working on it too (e.g. a designer + a developer). */
  collaborators: Types.ObjectId[];
  createdBy?: Types.ObjectId | null;
  status: TaskStatus;
  priority: Priority;
  progress: number;
  dueDate?: Date | null;
  completedAt?: Date | null;
  source: Source;
  telegramChatId?: string | null;
  telegramMessageId?: number | null;
  telegramBotMessageId?: number | null;
  /** Deleted tickets are kept (and can be restored) — every query skips them unless it asks for `deletedAt`. */
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    number: { type: Number, default: null },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    team: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    assignee: { type: Schema.Types.ObjectId, ref: "User", default: null },
    collaborators: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: TASK_STATUS, default: "todo" },
    priority: { type: String, enum: PRIORITY, default: "medium" },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    dueDate: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    source: { type: String, enum: SOURCES, default: "web" },
    telegramChatId: { type: String, default: null },
    telegramMessageId: { type: Number, default: null },
    // The bot's own confirmation message, so replies to it also point at this task.
    telegramBotMessageId: { type: Number, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

// Hide deleted tickets everywhere (boards, reports, EODs, the bot) unless the query names deletedAt itself.
// `{ deletedAt: null }` also matches tickets from before this field existed.
TaskSchema.pre(
  ["find", "findOne", "countDocuments", "findOneAndUpdate", "updateOne", "updateMany", "findOneAndDelete", "deleteOne", "deleteMany"],
  function () {
    if (!("deletedAt" in this.getFilter())) this.where({ deletedAt: null });
  },
);
TaskSchema.pre("aggregate", function () {
  const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
  if (!first?.$match || !("deletedAt" in first.$match)) this.pipeline().unshift({ $match: { deletedAt: null } });
});

TaskSchema.index({ number: 1 }, { unique: true, partialFilterExpression: { number: { $type: "number" } } });
TaskSchema.index({ assignee: 1, status: 1 });
TaskSchema.index({ collaborators: 1, status: 1 });
TaskSchema.index({ team: 1, status: 1 });
TaskSchema.index({ updatedAt: -1 });

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.Task) deleteModel("Task");
export const Task = (models.Task as Model<ITask>) || model<ITask>("Task", TaskSchema);
