"use client";

import { useActionState } from "react";

import { inviteMember, type InviteState } from "@/app/(app)/actions";

const initialInviteState: InviteState = { status: "idle" };

/*
 * Minimal invitation control. It reports the server action's result rather
 * than assuming success, because the only place the rules live is the server.
 */
export function InviteForm() {
  const [state, formAction, pending] = useActionState(
    inviteMember,
    initialInviteState
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="invite-email" className="text-[13px] text-text">
          Invite a teammate
        </label>
        <p className="text-[12px] text-muted">
          They join this workspace and see the same runs you do.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          placeholder="teammate@example.com"
          className="h-9 w-full max-w-xs rounded-md border border-border bg-raised px-3 text-[13px] text-text outline-none transition-colors placeholder:text-muted focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-9 shrink-0 rounded-md bg-accent px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:opacity-50"
        >
          {pending ? "Sending…" : "Invite"}
        </button>
      </div>
      {state.message ? (
        <p
          role="status"
          className={`text-[12px] ${
            state.status === "error" ? "text-outgoing" : "text-incoming"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
