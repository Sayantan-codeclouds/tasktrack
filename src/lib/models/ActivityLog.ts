import { Schema, deleteModel, model, models, type Model, type Types } from "mongoose";
import { ACTIVITY_TYPES, SOURCES, type ActivityType, type Source } from "../constants";

export interface IActivityLog {
  _id: Types.ObjectId;
  user?: Types.ObjectId | null;
  actor?: Types.ObjectId | null;
  task?: Types.ObjectId | null;
  team?: Types.ObjectId | null;
  type: ActivityType;
  message: string;
  source: Source;
  rawText?: string | null;
  aiConfidence?: number | null;
  meta?: Record<string, unknown> | null;
  createdAt: Date;
}

const ActivityLogSchema = new Schema<IActivityLog>(
  {
    // The person the activity is about (e.g. whose status changed, who the task belongs to).
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    // The person who caused it, when different (e.g. someone assigning a task to a teammate).
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    task: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    // The team the activity happened in (ticket's team, or the Telegram group it came from).
    team: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    message: { type: String, required: true },
    source: { type: String, enum: SOURCES, required: true },
    rawText: { type: String, default: null },
    aiConfidence: { type: Number, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ user: 1, createdAt: -1 });
ActivityLogSchema.index({ type: 1, createdAt: -1 });
ActivityLogSchema.index({ team: 1, createdAt: -1 });

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.ActivityLog) deleteModel("ActivityLog");
export const ActivityLog =
  (models.ActivityLog as Model<IActivityLog>) ||
  model<IActivityLog>("ActivityLog", ActivityLogSchema);
