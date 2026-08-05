export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold text-neutral-100">
          Sign-in error
        </h1>
        <p className="text-neutral-400">
          {error ?? "Something went wrong."}
        </p>
        <a href="/login" className="inline-block text-neutral-100 underline">
          Back to sign in
        </a>
      </div>
    </main>
  );
}
