"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";

export type InviteState = {
  status: "idle" | "sent" | "error";
  message?: string;
};

/*
 * Admin-only invitation, sent from the server so the recipient's acceptance
 * link returns them to this origin's sign-in page. Authorization is checked
 * against the token's role, not a round trip to the identity provider.
 */
export async function inviteMember(
  _previous: InviteState,
  formData: FormData
): Promise<InviteState> {
  const { userId, orgId, has } = await auth();

  if (!userId || !orgId) {
    return { status: "error", message: "No active organization." };
  }
  if (!has({ role: "org:admin" })) {
    return {
      status: "error",
      message: "Only organization admins can invite members.",
    };
  }

  const emailAddress = String(formData.get("email") ?? "").trim();
  if (!emailAddress) {
    return { status: "error", message: "Enter an email address." };
  }

  const host = (await headers()).get("host");
  const protocol =
    host && (host.startsWith("localhost") || host.startsWith("127."))
      ? "http"
      : "https";
  const redirectUrl = host ? `${protocol}://${host}/sign-in` : undefined;

  const clerk = await clerkClient();
  try {
    await clerk.organizations.createOrganizationInvitation({
      organizationId: orgId,
      inviterUserId: userId,
      emailAddress,
      role: "org:member",
      ...(redirectUrl ? { redirectUrl } : {}),
    });
  } catch {
    return { status: "error", message: "Could not send the invitation." };
  }

  return { status: "sent", message: `Invitation sent to ${emailAddress}.` };
}
