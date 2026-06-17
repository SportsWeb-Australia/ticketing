// Ticket One brand tokens. Logo paths point at files in /public/brand.
// If your filenames differ, change them here once.
export const BRAND = {
  name: 'Ticket One',
  tagline: 'Sell. Scan. Simplify.',
  logoHorizontal: '/brand/ticket-one-horizontal.png',        // header, light bg (has "Powered by SportsWeb One")
  logoStacked: '/brand/ticket-one-stacked.png',              // HERO, light bg — large
  logoStackedWhite: '/brand/ticket-one-stacked-white.png',   // footer, dark bg
  logoWhite: '/brand/ticket-one-white.png',                  // legacy horizontal white
  icon: '/brand/ticket-one-icon.png',                        // favicon + small marks
  colors: {
    graphite: '#11161D',
    orange: '#FF6A00',
    amber: '#FFC107',
    silver: '#C0C4CC',
    mist: '#F7F7F9',
  },
} as const;
