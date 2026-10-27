import { Schema, deleteModel, model, models, type Model, type Types } from "mongoose";
import { POSITIONS, PRESENCE, type Position, type Presence } from "../constants";

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  /** null for people who only sign in with Google. */
  passwordHash?: string | null;
  /** Google account id ("sub"), once they've used Continue with Google. */
  googleId?: string | null;
  role: "admin" | "member";
  /** Job role. null = not assigned yet. */
  position?: Position | null;
  /** Leadership role asked for at sign-up, waiting for a manager to approve. */
  requestedPosition?: Position | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  linkCode?: string | null;
  linkCodeExpires?: Date | null;
  presence: Presence;
  presenceNote?: string | null;
  presenceSince: Date;
  lastSeenAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null },
    googleId: { type: String, default: null },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    position: { type: String, enum: [...POSITIONS, null], default: null },
    requestedPosition: { type: String, enum: [...POSITIONS, null], default: null },
    telegramId: { type: String, default: null },
    telegramUsername: { type: String, default: null },
    linkCode: { type: String, default: null },
    linkCodeExpires: { type: Date, default: null },
    presence: { type: String, enum: PRESENCE, default: "offline" },
    presenceNote: { type: String, default: null },
    presenceSince: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

UserSchema.index(
  { telegramId: 1 },
  { unique: true, partialFilterExpression: { telegramId: { $type: "string" } } },
);
UserSchema.index({ linkCode: 1 }, { sparse: true });
UserSchema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: "string" } } });

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.User) deleteModel("User");
export const User = (models.User as Model<IUser>) || model<IUser>("User", UserSchema);

/**
 * Fields that are safe to send to other people's browsers.
 * Deliberately excludes `role`: who the admin is stays secret (only the admin sees roles).
 */
export const PUBLIC_USER_FIELDS =
  "name position telegramUsername telegramId presence presenceNote presenceSince lastSeenAt createdAt";
