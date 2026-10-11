import { clerkMiddleware } from "@clerk/nextjs/server";

/*
 * Sign-in and sign-up are the only public pages. The proxy redirects a
 * signed-out visitor away from everything else before the route is rendered,
 * so a protected page's HTML is never sent. This is an early redirect only:
 * the shell and each page still call auth.protect() for themselves, because a
 * matcher change can silently remove proxy coverage.
 */
const publicRoutes = [
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
