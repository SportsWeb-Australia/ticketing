import { BRAND } from './brand';

export default function BrandHeader() {
  return (
    <header className="flex items-center justify-center border-b border-slate-200 bg-white px-4 py-3">
      <a href="/" aria-label={BRAND.name}>
        <img src={BRAND.logoHorizontal} alt={BRAND.name} className="h-8 w-auto object-contain" />
      </a>
    </header>
  );
}
