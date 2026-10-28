import { Schema, deleteModel, model, models, type Model, type Types } from "mongoose";

export interface ITeamMember {
  user: Types.ObjectId;
  addedAt: Date;
  /** How they joined: added to the Telegram group, or added on the site. */
  via: "telegram" | "web";
}

/** Someone who is in the team's Telegram group but hasn't linked a tracker account yet. */
export interface ITeamPending {
  telegramId: string;
  username?: string | null;
  name: string;
  joinedAt: Date;
}

export interface ITeam {
  _id: Types.ObjectId;
  name: string;
  description?: string | null;
  color: string;
  createdBy?: Types.ObjectId | null;
  /** The team's Team Lead. */
  lead?: Types.ObjectId | null;
  /** The Manager overseeing the team. */
  manager?: Types.ObjectId | null;
  /** Shift timings, "HH:MM" in APP_TIMEZONE. EOD is posted at shiftEnd. */
  shiftStart?: string | null;
  shiftEnd?: string | null;
  members: ITeamMember[];
  pending: ITeamPending[];
  telegramChatId?: string | null;
  telegramChatTitle?: string | null;
  telegramLinkedAt?: Date | null;
  linkCode?: string | null;
  linkCodeExpires?: Date | null;
  /** Post EOD (workdays) and EOW (end of week) reports to the team's Telegram group. */
  reportsEnabled: boolean;
  /** Day (YYYY-MM-DD) / week start of the last automatic post — prevents double posting. */
  lastEodPostedFor?: string | null;
  lastEowPostedFor?: string | null;
  /** Day the "EOD in 30 minutes" reminder went out. */
  lastEodReminderFor?: string | null;
  /** Day the "who's absent" check ran (ABSENT_AFTER_MINUTES after shift start). */
  lastAbsenceCheckFor?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TeamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    color: { type: String, default: "#4c6ef5" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lead: { type: Schema.Types.ObjectId, ref: "User", default: null },
    manager: { type: Schema.Types.ObjectId, ref: "User", default: null },
    shiftStart: { type: String, default: null },
    shiftEnd: { type: String, default: null },
    members: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        addedAt: { type: Date, default: () => new Date() },
        via: { type: String, enum: ["telegram", "web"], default: "web" },
      },
    ],
    pending: [
      {
        _id: false,
        telegramId: { type: String, required: true },
        username: { type: String, default: null },
        name: { type: String, required: true },
        joinedAt: { type: Date, default: () => new Date() },
      },
    ],
    telegramChatId: { type: String, default: null },
    telegramChatTitle: { type: String, default: null },
    telegramLinkedAt: { type: Date, default: null },
    linkCode: { type: String, default: null },
    linkCodeExpires: { type: Date, default: null },
    reportsEnabled: { type: Boolean, default: true },
    lastEodPostedFor: { type: String, default: null },
    lastEowPostedFor: { type: String, default: null },
    lastEodReminderFor: { type: String, default: null },
    lastAbsenceCheckFor: { type: String, default: null },
  },
  { timestamps: true },
);

// One Telegram group belongs to at most one team.
TeamSchema.index({ telegramChatId: 1 }, { unique: true, partialFilterExpression: { telegramChatId: { $type: "string" } } });
TeamSchema.index({ linkCode: 1 }, { sparse: true });
TeamSchema.index({ "members.user": 1 });
TeamSchema.index({ lead: 1 });
TeamSchema.index({ manager: 1 });
TeamSchema.index({ "pending.telegramId": 1 });

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.Team) deleteModel("Team");
export const Team = (models.Team as Model<ITeam>) || model<ITeam>("Team", TeamSchema);
