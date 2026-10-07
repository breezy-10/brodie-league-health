const BRODIE_MARK =
  "https://cdn.prod.website-files.com/6921d2c2bd3b56136200df40/6921d2c2bd3b56136200e036_Brodie_Icon.svg";

export default async function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const msg =
    reason === "domain"
      ? "Your account isn't on the brodierec.com domain. Sign in with your Brodie email."
      : "Something went wrong signing you in. Try again, and if it keeps happening, message Sohaib.";
  return (
    <main className="auth-screen">
      <div className="auth-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="auth-mark" src={BRODIE_MARK} alt="Brodie" />
        <p className="auth-eyebrow">League Health</p>
        <h1 className="auth-title">Couldn&apos;t sign you in</h1>
        <p className="auth-body">{msg}</p>
        <a className="auth-btn" href="/login">
          Try again
        </a>
      </div>
    </main>
  );
}
