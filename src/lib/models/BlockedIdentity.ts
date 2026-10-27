import { Schema, deleteModel, model, models, type Model, type Types } from "mongoose";

/** Someone the admin deleted and blocked: none of these may sign up, sign in with Google, or link Telegram again. */
export interface IBlockedIdentity {
  _id: Types.ObjectId;
  /** Their name at the time, so the admin knows who it was. */
  name: string;
  email?: string | null;
  googleId?: string | null;
  telegramId?: string | null;
  telegramUsername?: string | null;
  createdAt: Date;
}

const BlockedIdentitySchema = new Schema<IBlockedIdentity>(
  {
    name: { type: String, required: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    googleId: { type: String, default: null },
    telegramId: { type: String, default: null },
    telegramUsername: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

BlockedIdentitySchema.index({ email: 1 });
BlockedIdentitySchema.index({ googleId: 1 });
BlockedIdentitySchema.index({ telegramId: 1 });

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.BlockedIdentity) deleteModel("BlockedIdentity");
export const BlockedIdentity =
  (models.BlockedIdentity as Model<IBlockedIdentity>) || model<IBlockedIdentity>("BlockedIdentity", BlockedIdentitySchema);

/** Whether any of these identities belongs to someone the admin blocked. */
export async function isBlocked(ids: { email?: string | null; googleId?: string | null; telegramId?: string | null }) {
  const or: Record<string, string>[] = [];
  if (ids.email) or.push({ email: ids.email.trim().toLowerCase() });
  if (ids.googleId) or.push({ googleId: ids.googleId });
  if (ids.telegramId) or.push({ telegramId: ids.telegramId });
  return or.length > 0 && Boolean(await BlockedIdentity.exists({ $or: or }));
}
