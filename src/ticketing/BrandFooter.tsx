import { BRAND } from './brand';

export default function BrandFooter() {
  return (
    <footer className="mt-auto bg-brand-graphite px-4 py-7 text-center">
      <img
        src={BRAND.logoWhite}
        alt={BRAND.name}
        className="mx-auto h-7 w-auto object-contain opacity-95"
      />
      <p className="mt-2 text-xs text-slate-400">Part of the SportsWeb One ecosystem</p>
    </footer>
  );
}
