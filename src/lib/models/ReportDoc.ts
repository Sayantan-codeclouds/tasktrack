import { Schema, deleteModel, model, models, type Model, type Types } from "mongoose";

export interface IEodTaskRow {
  ticket: string;
  title: string;
  status: string;
  progress: string;
  remarks: string;
}

/** The parts of an EOD / EOW a person can edit. Everything else (online time, etc.) is worked out live. */
export interface IEodContent {
  login: string;
  logout: string;
  summary: string;
  tasks: IEodTaskRow[];
  blockers: string;
  plan: string;
}

/** Someone's saved EOD (period "day", key = the day) or EOW (period "week", key = its Monday). */
export interface IReportDoc extends IEodContent {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  period: "day" | "week";
  key: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReportDocSchema = new Schema<IReportDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    period: { type: String, enum: ["day", "week"], required: true },
    key: { type: String, required: true },
    login: { type: String, default: "" },
    logout: { type: String, default: "" },
    summary: { type: String, default: "" },
    tasks: [
      {
        _id: false,
        ticket: { type: String, default: "" },
        title: { type: String, default: "" },
        status: { type: String, default: "" },
        progress: { type: String, default: "" },
        remarks: { type: String, default: "" },
      },
    ],
    blockers: { type: String, default: "" },
    plan: { type: String, default: "" },
  },
  { timestamps: true },
);

ReportDocSchema.index({ user: 1, period: 1, key: 1 }, { unique: true });
ReportDocSchema.index({ period: 1, key: 1 });

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.ReportDoc) deleteModel("ReportDoc");
export const ReportDoc = (models.ReportDoc as Model<IReportDoc>) || model<IReportDoc>("ReportDoc", ReportDocSchema);
