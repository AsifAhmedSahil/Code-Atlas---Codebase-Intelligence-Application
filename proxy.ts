import { clerkMiddleware } from "@clerk/nextjs/server";

/*
 * The public routes: the landing page at `/`, its older address `/welcome`
 * (kept only so it can redirect to `/`), the auth pages, and Clerk's own
 * endpoints. Everything else — the dashboard at `/dashboard`, `/analyses/*`,
 * and every API route — is protected. The proxy redirects a signed-out visitor
 * away from those before the route is rendered, so protected HTML is never
 * sent. This is an early redirect only: the shell and each page still call
 * auth.protect() for themselves, because a matcher change can silently remove
 * proxy coverage.
 */
const publicRoutes = [
  /^\/$/,
  /^\/welcome(\/.*)?$/,
  /^\/sign-in(\/.*)?$/,
  /^\/sign-up(\/.*)?$/,
  /^\/__clerk(\/.*)?$/,
];

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl;
  if (publicRoutes.some((route) => route.test(pathname))) {
    return;
  }

  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn({ returnBackUrl: request.url });
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
