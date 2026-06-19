import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-serif text-lg font-bold text-white">
          Q
        </span>
        <span className="font-serif text-2xl font-semibold tracking-tight">Quotebook</span>
      </Link>

      <div className="qb-card w-full max-w-sm p-6">{children}</div>

      <Link href="/" className="mt-6 text-sm text-ink-muted hover:text-ink">
        ← Continue as guest
      </Link>
    </div>
  );
}
