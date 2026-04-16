/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fiba: {
          dark: '#111720',
          darker: '#0B0F16',
          card: '#1A2030',
          border: '#2A3040',
          muted: '#929599',
          accent: '#F2FE5A',
          'accent-hover': '#E0EC4A',
          surface: '#21262E',
          'surface-2': '#2E333B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
