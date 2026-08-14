import { redirect } from "next/navigation";

// The app's landing page is the Dashboard. My Day lives at /my-day — it's the
// super-admin LM scorecard, not where most people want to start. Kept as a
// redirect rather than rendering the Dashboard here so the nav highlights the
// Dashboard tab and the URL says where you are.
export default function Home() {
  redirect("/dashboard");
}
