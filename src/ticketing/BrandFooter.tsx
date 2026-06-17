import { BRAND } from './brand';

export default function BrandFooter() {
  return (
    <footer className="mt-auto bg-brand-graphite px-4 py-9 text-center">
      <img
        src={BRAND.logoStackedWhite}
        alt={BRAND.name}
        className="mx-auto h-24 w-auto object-contain opacity-95"
      />
      <p className="mt-3 text-xs text-slate-400">Part of the SportsWeb One ecosystem</p>
    </footer>
  );
}
