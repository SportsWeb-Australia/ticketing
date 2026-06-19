import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { supabase } from '../lib/supabase';
import { renderMarkdown } from '../lib/markdown';
import VenueField from './VenueField';
import AdminShell, { RequireAdmin } from './AdminShell';

const TAB_LABELS: Record<Tab, string> = {
  details: 'Details', tickets: 'Tickets', look: 'Ticket Design', payments: 'Payments', report: 'Report',
};

/* ---------------- helpers ---------------- */
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const dollars = (c: number) => (c / 100).toFixed(2);
const cents = (v: string) => Math.round((parseFloat(v) || 0) * 100);
const fmt = (c?: number) => `$${((c ?? 0) / 100).toFixed(2)}`;

interface TType {
  id?: string; _tmp?: string;
  name: string; description: string; price: string;
  quantity_total: string; max_per_order: string;
  quantity_sold: number; is_active: boolean; sort_order: number;
}
type Tab = 'details' | 'tickets' | 'look' | 'payments' | 'report';

/* ---------------- entry ---------------- */
export default function EventEditor() {
  return <RequireAdmin render={(ctx) => (
    <AdminShell club={ctx.club} clubs={ctx.clubs} onClub={ctx.setClubId}>
      <Inner clubId={ctx.clubId!} />
    </AdminShell>
  )} />;
}

function Inner({ clubId }: { clubId: string }) {
  const { eventId } = useParams();
  const isNew = !eventId;
  const nav = useNavigate();

  const [tab, setTab] = useState<Tab>('details');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // event fields
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [capacity, setCapacity] = useState('');
  const [status, setStatus] = useState('draft');
  const [isFree, setIsFree] = useState(false);
  const [brandColor, setBrandColor] = useState('#1f6feb');
  const [logoUrl, setLogoUrl] = useState('');

  const [types, setTypes] = useState<TType[]>([]);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data: e } = await supabase.from('tk_events').select('*').eq('id', eventId).maybeSingle();
      if (e) {
        setName(e.name); setSlug(e.slug); setDescription(e.description ?? '');
        setVenueName(e.venue_name ?? ''); setVenueAddress(e.venue_address ?? '');
        setStartsAt(toLocal(e.starts_at)); setEndsAt(toLocal(e.ends_at));
        setCapacity(e.capacity == null ? '' : String(e.capacity));
        setStatus(e.status); setIsFree(e.is_free);
        setBrandColor(e.ticket_template?.brandColor ?? '#1f6feb');
        setLogoUrl(e.ticket_template?.logoUrl ?? '');
      }
      const { data: tt } = await supabase.from('tk_ticket_types')
        .select('*').eq('event_id', eventId).order('sort_order');
      setTypes((tt ?? []).map((t: any) => ({
        id: t.id, name: t.name, description: t.description ?? '',
        price: dollars(t.price_cents), quantity_total: t.quantity_total == null ? '' : String(t.quantity_total),
        max_per_order: String(t.max_per_order), quantity_sold: t.quantity_sold,
        is_active: t.is_active, sort_order: t.sort_order,
      })));
      setLoading(false);
    })();
  }, [eventId, isNew]);

  const addType = () => setTypes((t) => [...t, {
    _tmp: crypto.randomUUID(), name: '', description: '', price: '0.00',
    quantity_total: '', max_per_order: '10', quantity_sold: 0, is_active: true, sort_order: t.length,
  }]);
  const patchType = (i: number, p: Partial<TType>) =>
    setTypes((t) => t.map((x, idx) => (idx === i ? { ...x, ...p } : x)));
  const removeType = (i: number) => setTypes((t) => t.filter((_, idx) => idx !== i));

  const save = async (statusOverride?: string) => {
    const effStatus = statusOverride ?? status;
    setSaving(true); setMsg(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      const template = { ...(brandColor ? { brandColor } : {}), ...(logoUrl ? { logoUrl } : {}) };
      const payload: any = {
        club_id: clubId, name: name.trim(), slug: (slug || slugify(name)).trim(),
        description: description || null, venue_name: venueName || null, venue_address: venueAddress || null,
        starts_at: fromLocal(startsAt), ends_at: fromLocal(endsAt),
        capacity: capacity ? parseInt(capacity, 10) : null,
        status: effStatus, is_free: isFree, ticket_template: template, updated_at: new Date().toISOString(),
      };

      let id = eventId as string | undefined;
      if (isNew) {
        payload.created_by = u.user?.id ?? null;
        let res = await supabase.from('tk_events').insert(payload).select('id').single();
        if (res.error && res.error.code === '23505') { // slug clash
          payload.slug = `${payload.slug}-${Math.random().toString(36).slice(2, 6)}`;
          res = await supabase.from('tk_events').insert(payload).select('id').single();
        }
        if (res.error) throw res.error;
        id = res.data.id;
      } else {
        const { error } = await supabase.from('tk_events').update(payload).eq('id', id);
        if (error) throw error;
      }

      // ticket types: upsert existing + insert new
      for (const t of types) {
        if (!t.name.trim()) continue;
        const row: any = {
          event_id: id, club_id: clubId, name: t.name.trim(), description: t.description || null,
          price_cents: cents(t.price), quantity_total: t.quantity_total ? parseInt(t.quantity_total, 10) : null,
          max_per_order: parseInt(t.max_per_order || '10', 10), is_active: t.is_active, sort_order: t.sort_order,
          updated_at: new Date().toISOString(),
        };
        if (t.id) {
          const { error } = await supabase.from('tk_ticket_types').update(row).eq('id', t.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('tk_ticket_types').insert(row);
          if (error) throw error;
        }
      }

      if (statusOverride) setStatus(statusOverride);
      setMsg(statusOverride === 'published' ? 'Published ✓' : statusOverride === 'draft' ? 'Unpublished' : 'Saved ✓');
      if (isNew && id) nav(`/admin/e/${id}`, { replace: true });
    } catch (e: any) {
      setMsg(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-slate-500">Loading…</p>;

  const tabs: Tab[] = isNew ? ['details', 'tickets', 'look'] : ['details', 'tickets', 'look', 'payments', 'report'];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => nav('/admin')} className="text-sm text-slate-400">‹ Events</button>
        <div className="flex items-center gap-3">
          {msg && <span className="text-sm text-slate-500">{msg}</span>}
          {status !== 'published' && (
            <button onClick={() => save('published')} disabled={saving || !name.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {saving ? 'Working…' : 'Publish'}
            </button>
          )}
          {status === 'published' && (
            <button onClick={() => save('draft')} disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40">
              Unpublish
            </button>
          )}
          <button onClick={() => save()} disabled={saving || !name.trim()}
            className="rounded-lg bg-brand-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-brand-orange font-semibold text-slate-800' : 'text-slate-400'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <Card>
          <Field label="Event name">
            <input value={name} onChange={(e) => { setName(e.target.value); if (isNew) setSlug(slugify(e.target.value)); }} className={inp} placeholder="Twilight T20 Final" />
          </Field>
          <Field label="URL slug"><input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className={inp} /></Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${inp} h-32`} />
            <p className="mt-1 text-xs text-slate-400">
              Formatting: <code>**bold**</code>, <code>*italic*</code>, <code>[link](https://…)</code>, <code>- bullet</code>, <code># heading</code>.
            </p>
            {description.trim() && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-brand-mist p-3">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Preview</p>
                <div className="space-y-2 text-sm leading-relaxed text-slate-700"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(description) }} />
              </div>
            )}
          </Field>
          <VenueField
            venueName={venueName} venueAddress={venueAddress}
            setVenueName={setVenueName} setVenueAddress={setVenueAddress}
            inputClass={inp}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts"><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inp} /></Field>
            <Field label="Ends"><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inp} /></Field>
            <Field label="Capacity (blank = unlimited)"><input value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} className={inp} /></Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inp}>
                <option value="draft">Draft (hidden)</option>
                <option value="published">Published (live)</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
          </div>
          <label className="mt-1 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} /> Free event (no payment)
          </label>
        </Card>
      )}

      {tab === 'tickets' && (
        <Card>
          <div className="space-y-3">
            {types.map((t, i) => (
              <div key={t.id ?? t._tmp} className="rounded-lg border border-slate-200 p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Field label="Name"><input value={t.name} onChange={(e) => patchType(i, { name: e.target.value })} className={inp} placeholder="General Admission" /></Field>
                  <Field label="Price ($)"><input value={t.price} onChange={(e) => patchType(i, { price: e.target.value })} className={inp} inputMode="decimal" /></Field>
                  <Field label="Qty (blank = ∞)"><input value={t.quantity_total} onChange={(e) => patchType(i, { quantity_total: e.target.value.replace(/\D/g, '') })} className={inp} /></Field>
                  <Field label="Max / order"><input value={t.max_per_order} onChange={(e) => patchType(i, { max_per_order: e.target.value.replace(/\D/g, '') })} className={inp} /></Field>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    <input type="checkbox" checked={t.is_active} onChange={(e) => patchType(i, { is_active: e.target.checked })} /> Active
                    {t.quantity_sold > 0 && <span className="ml-2">· {t.quantity_sold} sold</span>}
                  </label>
                  <button
                    onClick={() => removeType(i)} disabled={t.quantity_sold > 0}
                    className="text-xs text-red-500 disabled:text-slate-300"
                    title={t.quantity_sold > 0 ? 'Cannot delete — tickets already sold' : ''}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={addType} className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600">
            + Add ticket type
          </button>
        </Card>
      )}

      {tab === 'look' && (
        <Card>
          <Field label="Brand colour (ticket + sales page accent)">
            <div className="flex items-center gap-2">
              <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-14 rounded border border-slate-300" />
              <input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className={inp} />
            </div>
          </Field>
          <LogoUpload clubId={clubId} logoUrl={logoUrl} setLogoUrl={setLogoUrl} />
          <p className="text-xs text-slate-400">Leave the colour as your club’s primary colour for white-label tickets.</p>
        </Card>
      )}

      {tab === 'payments' && !isNew && <Payments clubId={clubId} isFree={isFree} />}
      {tab === 'report' && !isNew && <Report eventId={eventId!} clubId={clubId} slug={slug} name={name} />}
    </div>
  );
}

/* ---------------- payments / connect ---------------- */
function Payments({ clubId, isFree }: { clubId: string; isFree: boolean }) {
  const [state, setState] = useState<'loading' | 'none' | 'ready' | 'pending' | 'nomigration'>('loading');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from('tk_club_stripe')
      .select('charges_enabled,stripe_account_id').eq('club_id', clubId).maybeSingle();
    if (error) { setState('nomigration'); return; }
    if (!data) setState('none');
    else setState(data.charges_enabled ? 'ready' : 'pending');
  };
  useEffect(() => { load(); }, [clubId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onboard = async () => {
    setBusy(true); setErr(null);
    const back = window.location.href;
    const { data, error } = await supabase.functions.invoke('tk-connect-onboard', {
      body: { club_id: clubId, return_url: back, refresh_url: back },
    });
    setBusy(false);
    if (error) { setErr('Onboarding function not available yet — deploy tk-connect-onboard.'); return; }
    if (data?.url) window.location.href = data.url;
  };

  return (
    <Card>
      <h2 className="mb-1 font-semibold text-slate-800">Payouts (Stripe)</h2>
      {isFree
        ? <p className="text-sm text-slate-500">This is a free event — no Stripe needed. Free tickets issue instantly.</p>
        : <>
            {state === 'loading' && <p className="text-sm text-slate-400">Checking…</p>}
            {state === 'nomigration' && <p className="text-sm text-amber-600">Run <code>db/tk_checkout.sql</code> to enable paid events.</p>}
            {state === 'none' && <p className="text-sm text-slate-500">Not connected. Paid tickets need a Stripe payout account.</p>}
            {state === 'pending' && <p className="text-sm text-amber-600">Onboarding started but not finished. Continue below.</p>}
            {state === 'ready' && <p className="text-sm text-emerald-600">Connected ✓ — paid tickets will pay out to this club.</p>}
            {state !== 'ready' && state !== 'nomigration' && (
              <button onClick={onboard} disabled={busy}
                className="mt-3 rounded-lg bg-brand-graphite px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? 'Opening Stripe…' : 'Set up payouts'}
              </button>
            )}
            {err && <p className="mt-2 text-sm text-red-500">{err}</p>}
          </>}
    </Card>
  );
}

/* ---------------- report ---------------- */
function Report({ eventId, clubId, slug, name }: { eventId: string; clubId: string; slug: string; name: string }) {
  const [s, setS] = useState<any>(null);
  const [fee, setFee] = useState<any>(null);
  const qrWrap = useRef<HTMLDivElement>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = `${origin}/e/${eventId}`;
  const embed = `<iframe src="${origin}/e/${eventId}?embed=1" style="width:100%;border:0" title="Tickets"></iframe>`;
  const title = name || 'Get your tickets';

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('tk_event_sales_summary').select('*').eq('event_id', eventId).maybeSingle();
      setS(data);
      const { data: f } = await supabase.rpc('tk_fee_for_club', { p_club_id: clubId });
      setFee(Array.isArray(f) ? f[0] : f);
    })();
  }, [eventId, clubId]);

  const copy = (t: string) => navigator.clipboard?.writeText(t);

  const shares = [
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}` },
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(link)}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${title} ${link}`)}` },
    { label: 'Email', href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(link)}` },
  ];
  const nativeShare = () => (navigator as any).share?.({ title, url: link }).catch(() => {});

  const downloadQR = () => {
    const svg = qrWrap.current?.querySelector('svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const size = 720, c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 60, 60, size - 120, size - 120);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png'); a.download = `${slug || 'event'}-qr.png`; a.click();
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Sales</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Tickets in / issued" value={`${s?.tickets_redeemed ?? 0} / ${s?.tickets_issued ?? 0}`} />
          <Stat label="Paid orders" value={s?.paid_orders ?? 0} />
          <Stat label="Gross (face)" value={fmt(s?.gross_cents)} />
          <Stat label="Collected" value={fmt(s?.collected_cents)} />
        </div>
        {fee && (
          <p className="mt-3 text-xs text-slate-400">
            Platform fee applied: {(fee.percent_bps / 100).toFixed(2)}%
            {fee.fixed_cents ? ` + ${fmt(fee.fixed_cents)} ${fee.fixed_basis === 'per_ticket' ? '/ticket' : '/order'}` : ''}
            {' '}· deducted from club proceeds (buyer pays face value).
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Share</h2>
        <p className="text-xs text-slate-400">Public link {slug ? `(/${slug})` : ''}</p>
        <div className="mt-1 flex gap-2">
          <input readOnly value={link} className={`${inp} text-slate-500`} />
          <button onClick={() => copy(link)} className="rounded-lg border border-slate-300 px-3 text-sm">Copy</button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {shares.map((sh) => (
            <a key={sh.label} href={sh.href} target="_blank" rel="noreferrer"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:border-brand-orange">
              {sh.label}
            </a>
          ))}
          {typeof navigator !== 'undefined' && (navigator as any).share && (
            <button onClick={nativeShare} className="rounded-lg bg-brand-graphite px-3 py-1.5 text-sm font-semibold text-white">Share…</button>
          )}
        </div>

        <div className="mt-5 flex items-center gap-4 border-t border-slate-100 pt-4">
          <div ref={qrWrap} className="rounded-lg border border-slate-200 bg-white p-2">
            <QRCode value={link} size={108} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Event QR code</p>
            <p className="text-xs text-slate-400">Print it on posters or flyers — scanning opens the ticket page.</p>
            <button onClick={downloadQR} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Download QR (PNG)</button>
          </div>
        </div>

        <p className="mt-5 text-xs text-slate-400">Embed (auto-resizing iframe)</p>
        <div className="mt-1 flex gap-2">
          <input readOnly value={embed} className={`${inp} text-slate-500`} />
          <button onClick={() => copy(embed)} className="rounded-lg border border-slate-300 px-3 text-sm">Copy</button>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- logo upload ---------------- */
function LogoUpload({ clubId, logoUrl, setLogoUrl }: { clubId: string; logoUrl: string; setLogoUrl: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!/^image\//.test(file.type)) { setErr('Please choose an image file.'); return; }
    if (file.size > 3 * 1024 * 1024) { setErr('Image must be under 3 MB.'); return; }
    setBusy(true); setErr(null);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${clubId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('tk-logos').upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setErr(/bucket not found/i.test(error.message) ? 'Storage not set up yet — run the tk-logos bucket SQL.' : error.message);
      setBusy(false);
      return;
    }
    const { data } = supabase.storage.from('tk-logos').getPublicUrl(path);
    setLogoUrl(data.publicUrl);
    setBusy(false);
  };

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-500">Logo (shown on ticket + page)</span>
      {logoUrl && (
        <img src={logoUrl} alt="" className="mb-2 h-16 w-16 rounded-lg border border-slate-200 bg-white object-contain p-1" />
      )}
      <div className="flex items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm hover:border-brand-orange">
          {busy ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
          <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} />
        </label>
        {logoUrl && <button onClick={() => setLogoUrl('')} className="text-sm text-red-500">Remove</button>}
      </div>
      <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className={`${inp} mt-2`} placeholder="…or paste an image URL" />
      {err && <p className="mt-1 text-sm text-red-500">{err}</p>}
    </div>
  );
}

/* ---------------- bits ---------------- */
const inp = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-orange';
function Card({ children }: { children: ReactNode }) {
  return <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">{children}</div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>;
}
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-brand-mist p-3">
      <div className="text-lg font-bold text-slate-800">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}
