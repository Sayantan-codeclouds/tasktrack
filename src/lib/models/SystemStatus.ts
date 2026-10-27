import { Schema, deleteModel, model, models, type Model } from "mongoose";

/** Small key/value status docs, e.g. { _id: "bot" } — the bot's heartbeat for the admin page. */
export interface ISystemStatus {
  _id: string;
  lastSeenAt: Date;
  startedAt?: Date | null;
  info?: Record<string, unknown> | null;
}

const SystemStatusSchema = new Schema<ISystemStatus>(
  {
    _id: { type: String, required: true },
    lastSeenAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    info: { type: Schema.Types.Mixed, default: null },
  },
  { collection: "systemstatus" },
);

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.SystemStatus) deleteModel("SystemStatus");
export const SystemStatus =
  (models.SystemStatus as Model<ISystemStatus>) || model<ISystemStatus>("SystemStatus", SystemStatusSchema);
