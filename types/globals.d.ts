export {};

/*
 * Custom claims added to the Clerk session token (Dashboard → Sessions →
 * Customize session token, or `clerk config patch`). Declaring them here makes
 * them typed on `auth().sessionClaims`.
 */
declare global {
  interface CustomJwtSessionClaims {
    org_name?: string;
  }
}
