// Ticket One brand tokens. Logo paths point at files in /public.
// If your filenames differ, change them here once.
export const BRAND = {
  name: 'Ticket One',
  tagline: 'Sell. Scan. Simplify.',
  logoHorizontal: '/ticket-one-horizontal.png', // header, light backgrounds
  logoWhite: '/ticket-one-white.png',           // footer, dark backgrounds
  icon: '/ticket-one-icon.png',                 // favicon + small marks
  colors: {
    graphite: '#11161D',
    orange: '#FF6A00',
    amber: '#FFC107',
    silver: '#C0C4CC',
    mist: '#F7F7F9',
  },
} as const;
