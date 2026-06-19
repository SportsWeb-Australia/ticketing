import type { ReactNode } from 'react';

// Dependency-free SVG charts. Kept deliberately small so there's nothing to
// compile-test or version — just maths and rects.

export function Bars({
  data, height = 120, color = '#FF6A00', valueFmt,
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  valueFmt?: (v: number) => string;
}) {
  if (!data.length) return <p className="text-sm text-slate-400">No data yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const W = 600;
  const H = height;
  const gap = Math.min(8, 240 / n);
  const bw = (W - gap * (n + 1)) / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {data.map((d, i) => {
        const h = (d.value / max) * (H - 6);
        const x = gap + i * (bw + gap);
        const y = H - h;
        return (
          <rect key={i} x={x} y={y} width={bw} height={h} rx={Math.min(3, bw / 3)} fill={color}>
            <title>{d.label}: {valueFmt ? valueFmt(d.value) : d.value}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function Donut({
  value, total, size = 116, color = '#FF6A00', track = '#E5E7EB', center,
}: {
  value: number;
  total: number;
  size?: number;
  color?: string;
  track?: string;
  center?: ReactNode;
}) {
  const stroke = 12;
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {center}
      </div>
    </div>
  );
}
