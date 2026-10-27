import { NextResponse } from "next/server";
import { jsonError, withUser } from "@/lib/api";
import { User } from "@/lib/models/User";

export const dynamic = "force-dynamic";

/** The browser already crops and shrinks the photo; this is just a ceiling. */
const MAX_BYTES = 300 * 1024;

/** Work out the type from the file's first bytes — never trust the name or the browser's label. */
function imageType(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** PUT /api/me/avatar (multipart, field "photo") — set your profile photo. */
export const PUT = withUser(async (req, { user }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof Blob)) return jsonError("Choose a photo", 400);
  if (file.size > MAX_BYTES) return jsonError("That photo is too large", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) return jsonError("Use a JPEG, PNG or WebP image", 415);

  const version = Date.now();
  await User.updateOne({ _id: user._id }, { $set: { avatar: bytes, avatarType: type, avatarVersion: version } });
  return NextResponse.json({ ok: true, avatarVersion: version });
});

/** DELETE /api/me/avatar — go back to initials. */
export const DELETE = withUser(async (_req, { user }) => {
  await User.updateOne({ _id: user._id }, { $set: { avatar: null, avatarType: null, avatarVersion: null } });
  return NextResponse.json({ ok: true });
});
