"use client";

// Opens the browser's print dialog. A client component because a server
// page can't hand an onClick to the DOM; passing one threw, and the monthly
// review page failed to render at all.
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="br-btn is-grey is-sm print:hidden">
      {label}
    </button>
  );
}
