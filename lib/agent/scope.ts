// The scoped analysis credential the agent presents to its own HTTP surface.
//
// The application mints one only after it has authenticated the user and proved
// that the user's organization owns the analysis; the agent service verifies it
// before reading a single row. Everything the agent is allowed to see comes from
// here, so a conversation, a tool argument, or a filename quoted out of some
// repository file cannot widen the scope — none of those are inputs to
// verification.
//
// The token is an HMAC-SHA256 compact token built on `node:crypto`. A JWT
// library would add a dependency for the same three pieces of work: encode a
// payload, sign it, refuse it when the signature or the clock says no. The
// signing secret stays on the server; neither the browser nor the model ever
// receives it.

import { createHmac, timingSafeEqual } from "node:crypto";

const VERSION = 1;

// Bound so a forged or corrupt token cannot make the verifier do work proportional
// to its length, and so the analysis and organization it names stay recognisable.
export const MAX_ID_LENGTH = 128;

export interface AgentScopeClaims {
  // The one analysis this credential may read.
  analysisId: string;
  // The organization that owns that analysis. Enforced on every query, not only
  // on the analysis row, so a mis-owned child row cannot leak either.
  organizationId: string;
  issuedAt: number;
  expiresAt: number;
  issuer: string;
  audience: string;
}

export type VerifyFailure =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "wrong_issuer"
  | "wrong_audience";

export type VerifyOutcome =
  | { ok: true; claims: AgentScopeClaims }
  | { ok: false; reason: VerifyFailure };

export interface MintInput {
  analysisId: string;
  organizationId: string;
  secret: string;
  ttlSeconds: number;
  issuer?: string;
  audience?: string;
  now?: number;
}

export const DEFAULT_ISSUER = "cartography-app";
export const DEFAULT_AUDIENCE = "cartography-agent";

// Short by design. The credential is minted per conversation turn, so a long
// life buys nothing but a longer window for a stolen token.
export const DEFAULT_TTL_SECONDS = 300;

function b64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function b64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function isPrintableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9_.:-]+$/.test(value)
  );
}

function sign(payloadSegment: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadSegment).digest("base64url");
}

// Throws on input that could never be a legitimate claim set — an empty id or an
// absurd lifetime is a programming error, not something to encode and hope.
export function mintScopedCredential(input: MintInput): string {
  if (!isPrintableId(input.analysisId)) {
    throw new Error("mintScopedCredential: analysisId is not a usable identifier.");
  }
  if (!isPrintableId(input.organizationId)) {
    throw new Error("mintScopedCredential: organizationId is not a usable identifier.");
  }
  if (input.secret.trim().length < 16) {
    throw new Error("mintScopedCredential: the signing secret is too short to be trusted.");
  }
  if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new Error("mintScopedCredential: ttlSeconds must be a positive number.");
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload = {
    v: VERSION,
    sub: input.analysisId,
    org: input.organizationId,
    iat: now,
    exp: now + Math.floor(input.ttlSeconds),
    iss: input.issuer ?? DEFAULT_ISSUER,
    aud: input.audience ?? DEFAULT_AUDIENCE,
  };

  const payloadSegment = b64urlEncode(JSON.stringify(payload));
  return `v${VERSION}.${payloadSegment}.${sign(payloadSegment, input.secret)}`;
}

export interface VerifyInput {
  token: string;
  secret: string;
  issuer?: string;
  audience?: string;
  // Injected so a test can pin the clock rather than wait for a real expiry.
  now?: number;
}

// Constant-time on the signature so a wrong guess cannot be timed out of the
// verifier. Every rejection returns a distinct reason for logs, and the same
// "not authorized" shape to the caller, so an attacker cannot tell a bad
// signature from an expired one by the response.
export function verifyScopedCredential(input: VerifyInput): VerifyOutcome {
  const parts = input.token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [version, payloadSegment, signature] = parts;
  if (version !== `v${VERSION}` || !payloadSegment || !signature) {
    return { ok: false, reason: "malformed" };
  }

  const expected = sign(payloadSegment, input.secret);
  const given = Buffer.from(signature, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(b64urlDecode(payloadSegment));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, reason: "malformed" };
  }

  const candidate = payload as Record<string, unknown>;
  if (
    !isPrintableId(candidate.sub) ||
    !isPrintableId(candidate.org) ||
    typeof candidate.iat !== "number" ||
    typeof candidate.exp !== "number" ||
    typeof candidate.iss !== "string" ||
    typeof candidate.aud !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (candidate.iss !== (input.issuer ?? DEFAULT_ISSUER)) {
    return { ok: false, reason: "wrong_issuer" };
  }
  if (candidate.aud !== (input.audience ?? DEFAULT_AUDIENCE)) {
    return { ok: false, reason: "wrong_audience" };
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  // A credential issued in the future is refused outright rather than treated as
  // freshly minted: a clock that far out means something is wrong.
  if (candidate.iat > now + 60) return { ok: false, reason: "malformed" };
  if (candidate.exp <= now) return { ok: false, reason: "expired" };

  return {
    ok: true,
    claims: {
      analysisId: candidate.sub,
      organizationId: candidate.org,
      issuedAt: candidate.iat,
      expiresAt: candidate.exp,
      issuer: candidate.iss,
      audience: candidate.aud,
    },
  };
}
