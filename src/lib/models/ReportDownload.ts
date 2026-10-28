import { Schema, deleteModel, model, models, type Model, type Types } from "mongoose";

/** Someone downloaded their own EOD (period "day", key = the day) or EOW (key = its Monday) — to send on to HR. */
export interface IReportDownload {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  period: "day" | "week";
  key: string;
  /** Last time they downloaded it. */
  at: Date;
  via: "web" | "telegram";
}

const ReportDownloadSchema = new Schema<IReportDownload>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  period: { type: String, enum: ["day", "week"], required: true },
  key: { type: String, required: true },
  at: { type: Date, required: true },
  via: { type: String, enum: ["web", "telegram"], required: true },
});

ReportDownloadSchema.index({ user: 1, period: 1, key: 1 }, { unique: true });
ReportDownloadSchema.index({ period: 1, key: 1 });

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.ReportDownload) deleteModel("ReportDownload");
export const ReportDownload =
  (models.ReportDownload as Model<IReportDownload>) || model<IReportDownload>("ReportDownload", ReportDownloadSchema);
