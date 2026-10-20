// Minting the scoped analysis credential.
//
// The application holds the signing secret and the agent service holds the
// verification half of the same secret. Nothing else in the repository reads
// `AGENT_CREDENTIAL_SECRET`, which is the point: a leak anywhere would have to
// leak through this one module.
//
// The minter refuses a missing secret and refuses a weak one. A silent
// fallback would mean an application that appears to have an authorisation
// boundary and does not.

import { mintScopedCredential, DEFAULT_TTL_SECONDS } from "@/lib/agent/scope";

// Minted per turn rather than per session. The reader's access is checked
// again on the next turn, so a revoked membership takes effect on the next
// question rather than whenever a long token happens to expire.
export const CREDENTIAL_TTL_SECONDS = DEFAULT_TTL_SECONDS;

export class CredentialSecretError extends Error {
  constructor() {
    super(
      "AGENT_CREDENTIAL_SECRET is not set, or is shorter than 16 characters. " +
        "The agent conversation cannot be authorised without it — set it in .env.local.",
    );
    this.name = "CredentialSecretError";
  }
}

export function requireCredentialSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env.AGENT_CREDENTIAL_SECRET?.trim();
  if (!secret || secret.length < 16) throw new CredentialSecretError();
  return secret;
}

export interface MintScopeInput {
  analysisId: string;
  organizationId: string;
  ttlSeconds?: number;
}

// The only call that produces a credential. It is reached only after the
// caller has authenticated the user and proved the analysis belongs to the
// user's organization with the user's own row-scoped token — never merely
// because a client sent an analysis id.
export function mintAnalysisCredential(input: MintScopeInput): string {
  return mintScopedCredential({
    analysisId: input.analysisId,
    organizationId: input.organizationId,
    secret: requireCredentialSecret(),
    ttlSeconds: input.ttlSeconds ?? CREDENTIAL_TTL_SECONDS,
  });
}
