import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export default async function AppHomePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email as string | undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-2xl font-semibold text-neutral-100">
          You&apos;re signed in
        </h1>
        {email && <p className="text-neutral-400">{email}</p>}
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-neutral-700 px-3 py-2 text-neutral-100"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
