import { BRAND } from './brand';
import BrandFooter from './BrandFooter';

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-mist">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <img
          src={BRAND.logoHorizontal}
          alt={BRAND.name}
          className="h-12 w-auto object-contain"
        />
        <h1 className="mt-7 text-2xl font-extrabold tracking-tight text-brand-graphite sm:text-3xl">
          {BRAND.tagline}
        </h1>
        <p className="mt-3 max-w-sm text-slate-500">
          Smart ticketing for clubs, events and associations. Open your event
          link to buy tickets.
        </p>
      </main>
      <BrandFooter />
    </div>
  );
}
