import { permanentRedirect } from "next/navigation";

/*
 * The landing page lived here before it moved to /. Kept as a permanent
 * redirect so any link or bookmark to /welcome still lands on the real page.
 */
export default function WelcomeRedirect() {
  permanentRedirect("/");
}
