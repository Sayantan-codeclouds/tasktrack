import mongoose from "mongoose";

// Reuse one connection across hot reloads in dev and across route invocations.
const globalForMongoose = globalThis as unknown as {
  mongooseConn?: Promise<typeof mongoose>;
};

export function connectDB(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  if (!globalForMongoose.mongooseConn) {
    globalForMongoose.mongooseConn = mongoose.connect(uri).catch((err) => {
      globalForMongoose.mongooseConn = undefined;
      throw err;
    });
  }
  return globalForMongoose.mongooseConn;
}
