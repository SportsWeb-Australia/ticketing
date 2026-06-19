import { useEffect, useRef, useState } from 'react';

// Address autocomplete needs a Google Maps key; the map preview does NOT.
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

// Load the Maps JS + Places library once, lazily. Returns null if no key.
let mapsPromise: Promise<any> | null = null;
function loadMaps(): Promise<any> | null {
  if (!MAPS_KEY || typeof window === 'undefined') return null;
  const w = window as any;
  if (w.google?.maps?.places) return Promise.resolve(w.google);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places&loading=async`;
    s.async = true;
    s.onload = () => resolve(w.google);
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return mapsPromise;
}

interface Props {
  venueName: string;
  venueAddress: string;
  setVenueName: (v: string) => void;
  setVenueAddress: (v: string) => void;
  inputClass: string;
}

export default function VenueField({
  venueName, venueAddress, setVenueName, setVenueAddress, inputClass,
}: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [hasMaps, setHasMaps] = useState(false);

  useEffect(() => {
    const p = loadMaps();
    if (!p) return;
    let ac: any;
    p.then((google) => {
      if (!nameRef.current) return;
      ac = new google.maps.places.Autocomplete(nameRef.current, {
        fields: ['name', 'formatted_address'],
        componentRestrictions: { country: 'au' },
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (place?.name) setVenueName(place.name);
        if (place?.formatted_address) setVenueAddress(place.formatted_address);
      });
      setHasMaps(true);
    }).catch(() => { /* fall back to plain inputs */ });
    return () => {
      const w = window as any;
      if (ac && w.google) w.google.maps.event.clearInstanceListeners(ac);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = (venueAddress || venueName).trim();
  const mapSrc = q ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed` : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">
            Venue name{hasMaps && <span className="text-slate-400"> · search to autofill</span>}
          </span>
          <input
            ref={nameRef}
            value={venueName}
            onChange={(e) => setVenueName(e.target.value)}
            className={inputClass}
            placeholder={hasMaps ? 'Start typing a venue…' : 'Venue name'}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Venue address</span>
          <input
            value={venueAddress}
            onChange={(e) => setVenueAddress(e.target.value)}
            className={inputClass}
            placeholder="Street, suburb, state"
          />
        </label>
      </div>
      {mapSrc && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <iframe
            title="Venue map"
            src={mapSrc}
            className="h-48 w-full"
            style={{ border: 0 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}
    </div>
  );
}
