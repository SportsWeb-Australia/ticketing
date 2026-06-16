// Minimal index. The module is reached via an event link, not this page.
export default function Landing() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold">SportsWeb One — Tickets</h1>
      <p className="mt-2 text-slate-600">
        Open an event link to buy tickets, e.g. <code>/e/&lt;event-id&gt;</code>.
      </p>
    </div>
  );
}
