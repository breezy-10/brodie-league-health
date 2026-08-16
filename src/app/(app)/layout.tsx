import { Nav } from "@/components/Nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--glass-background)" }}
    >
      <Nav />
      <main className="flex-1 overflow-auto px-4 sm:px-10 pb-5 sm:pb-8">
        {/* Top spacing lives INSIDE the scroll container: padding-top on a
            scrolling element leaves a band that sticky headers sit below. */}
        <div className="pt-5 sm:pt-8">{children}</div>
      </main>
    </div>
  );
}
