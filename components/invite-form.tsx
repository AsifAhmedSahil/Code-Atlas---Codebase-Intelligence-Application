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
    <form action={formAction} className="flex flex-col gap-2">
      <label
        htmlFor="invite-email"
        className="text-[11px] font-medium uppercase tracking-wide text-muted"
      >
        Invite a teammate
      </label>
      <div className="flex items-center gap-2">
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          placeholder="teammate@example.com"
          className="h-8 flex-1 rounded border border-border bg-surface px-2 text-[13px] text-text outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-8 rounded bg-accent px-3 text-[12px] font-medium text-white transition-opacity disabled:opacity-50"
        >
          {pending ? "Sending…" : "Invite"}
        </button>
      </div>
      {state.message ? (
        <p
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
