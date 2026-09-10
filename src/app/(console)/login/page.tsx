"use client";

import { useActionState } from "react";
import { sendMagicLink, type SendMagicLinkResult } from "./actions";

const initialState: SendMagicLinkResult = { error: null, sent: false };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    sendMagicLink,
    initialState,
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-neutral-100">Sign in</h1>

        {state.sent ? (
          <p className="text-neutral-300">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form action={formAction} className="space-y-4">
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-neutral-100 px-3 py-2 font-medium text-neutral-900 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send magic link"}
            </button>
            {state.error && (
              <p className="text-sm text-red-400">{state.error}</p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
