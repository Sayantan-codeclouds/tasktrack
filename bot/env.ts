// Imported first by bot/index.ts so env vars are in place before anything reads them.
import { config } from "dotenv";
import tls from "node:tls";

config({ path: [".env.local", ".env"], quiet: true });

// Node 24 (OpenSSL 3.5) offers a post-quantum key exchange that makes the TLS ClientHello larger.
// Some firewalls/antivirus web filters silently drop it, so connections to parts of Cloudflare
// (which fronts Groq) hang until they time out. Offering only the classic groups avoids that.
// Set TLS_ECDH_CURVE=auto to restore Node's default.
tls.DEFAULT_ECDH_CURVE = process.env.TLS_ECDH_CURVE || "X25519:P-256:P-384";
