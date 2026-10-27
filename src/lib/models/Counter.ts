import { Schema, deleteModel, model, models, type Model } from "mongoose";

interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

// In dev, hot reload re-runs this file: drop the cached model so schema edits take effect.
if (process.env.NODE_ENV !== "production" && models.Counter) deleteModel("Counter");
export const Counter = (models.Counter as Model<ICounter>) || model<ICounter>("Counter", CounterSchema);

/** Atomically reserve the next number in a named sequence. */
export async function nextSeq(name: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return doc!.seq;
}
