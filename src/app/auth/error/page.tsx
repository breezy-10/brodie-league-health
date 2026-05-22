export default async function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const msg =
    reason === "domain"
      ? "Your account isn't on the brodierec.com domain. Sign in with your Brodie email."
      : "Something went wrong signing you in.";
  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-brodie-ink text-brodie-fg">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold mb-4">No dice.</h1>
        <p className="text-brodie-dim mb-6">{msg}</p>
        <a href="/login" className="inline-block px-4 py-2 rounded bg-brodie-accent text-black font-semibold">
          Try again
        </a>
      </div>
    </main>
  );
}
