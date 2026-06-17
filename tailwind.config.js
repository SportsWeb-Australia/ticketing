/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          graphite: '#11161D',
          orange: '#FF6A00',
          amber: '#FFC107',
          silver: '#C0C4CC',
          mist: '#F7F7F9',
        },
      },
    },
  },
  plugins: [],
};
