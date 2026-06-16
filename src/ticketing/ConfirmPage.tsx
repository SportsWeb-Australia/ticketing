// Order confirmation — stub. The checkout step (tk-checkout + webhook) will
// pass back an order id; this page will then load the order + issued tickets
// and show the QR(s). For now it confirms the redirect target exists.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function ConfirmPage() {
  const orderId = new URLSearchParams(window.location.search).get('order');
  const [msg, setMsg] = useState('Finalising your tickets…');

  useEffect(() => {
    if (!orderId) {
      setMsg('Thanks! Your tickets are on the way to your email.');
      return;
    }
    // Placeholder: once tk_tickets are issued by the webhook, load + render QRs.
    void supabase;
    setMsg('Thanks! Your tickets are confirmed and on the way to your email.');
  }, [orderId]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">
        ✓
      </div>
      <h1 className="text-xl font-semibold">You're in</h1>
      <p className="mt-2 text-slate-600">{msg}</p>
    </div>
  );
}
