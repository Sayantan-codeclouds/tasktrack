import { randomInt } from "node:crypto";
import { User } from "./models/User";
import { Team } from "./models/Team";

export const LINK_CODE_TTL_MS = 15 * 60_000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

/**
 * A one-time code for `/link CODE`. People and teams share the same command,
 * so codes are unique across both.
 */
export async function newLinkCode(): Promise<string> {
  for (;;) {
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    const [u, t] = await Promise.all([User.exists({ linkCode: code }), Team.exists({ linkCode: code })]);
    if (!u && !t) return code;
  }
}
