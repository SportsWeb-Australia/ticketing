import { useEffect, useState } from 'react';
import { Routes, Route, useParams, useSearchParams } from 'react-router-dom';
import EventSalesPage from './ticketing/EventSalesPage';
import ConfirmPage from './ticketing/ConfirmPage';
import ClubEmbed from './ticketing/ClubEmbed';
import Landing from './ticketing/Landing';
import ScannerHome from './scanner/ScannerHome';
import ScanEvent from './scanner/ScanEvent';
import CodeScan from './scanner/CodeScan';
import EventsList from './admin/EventsList';
import ClubDashboard from './admin/ClubDashboard';
import EventEditor from './admin/EventEditor';
import AdminStaff from './admin/AdminStaff';
import { resolveClubIdBySlug } from './lib/club';

// /e/:eventId — works with zero assumptions about the clubs table.
function EventById() {
  const { eventId } = useParams();
  const [sp] = useSearchParams();
  return <EventSalesPage eventId={eventId} embed={sp.get('embed') === '1'} />;
}

// /:clubSlug/e/:eventSlug — pretty URLs (needs clubs.slug readable by anon).
function EventBySlug() {
  const { clubSlug, eventSlug } = useParams();
  const [sp] = useSearchParams();
  const [clubId, setClubId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let on = true;
    (async () => {
      const id = clubSlug ? await resolveClubIdBySlug(clubSlug) : null;
      if (on) { setClubId(id); setReady(true); }
    })();
    return () => { on = false; };
  }, [clubSlug]);
  if (!ready) return <div className="mx-auto max-w-2xl p-6 text-slate-500">Loading…</div>;
  return <EventSalesPage slug={eventSlug} clubId={clubId ?? undefined} embed={sp.get('embed') === '1'} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/e/:eventId" element={<EventById />} />
      <Route path="/embed/:clubId" element={<ClubEmbed />} />
      <Route path="/:clubSlug/e/:eventSlug" element={<EventBySlug />} />
      <Route path="/tickets/confirm" element={<ConfirmPage />} />

      {/* gate scanner (installable PWA) */}
      <Route path="/scan" element={<ScannerHome />} />
      <Route path="/scan/code" element={<CodeScan />} />
      <Route path="/scan/:eventId" element={<ScanEvent />} />

      {/* club admin */}
      <Route path="/admin" element={<ClubDashboard />} />
      <Route path="/admin/events" element={<EventsList />} />
      <Route path="/admin/staff" element={<AdminStaff />} />
      <Route path="/admin/new" element={<EventEditor />} />
      <Route path="/admin/e/:eventId" element={<EventEditor />} />
    </Routes>
  );
}
