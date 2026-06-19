// Ticket One brand tokens. Logo paths point at transparent PNGs in /public/brand.
export const BRAND = {
  name: 'Ticket One',
  tagline: 'Sell. Scan. Simplify.',
  logoHorizontal: '/brand/ticket-one-head.png',       // header (transparent)
  logoStacked: '/brand/ticket-one-hero.png',          // HERO, big (transparent)
  logoStackedWhite: '/brand/ticket-one-foot-white.png', // footer, dark bg (transparent)
  icon: '/brand/ticket-one-icon.png',                 // favicon + PWA (emblem, transparent)
  colors: {
    graphite: '#11161D',
    orange: '#FF6A00',
    amber: '#FFC107',
    silver: '#C0C4CC',
    mist: '#F7F7F9',
  },
} as const;
