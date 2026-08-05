import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="text-center">
        <h1 className="mb-4 text-2xl font-semibold text-neutral-100">
          Workout App
        </h1>
        <Link href="/login" className="text-neutral-300 underline">
          Sign in
        </Link>
      </div>
    </main>
  );
}
