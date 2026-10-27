import tls from "node:tls";

// Same workaround as bot/env.ts: some firewalls drop Node 24's post-quantum TLS handshake,
// which makes outgoing HTTPS (e.g. posting reports to Telegram) hang. Offer the classic groups.
tls.DEFAULT_ECDH_CURVE = process.env.TLS_ECDH_CURVE || "X25519:P-256:P-384";
