/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          ctm: '#1e3a5f',
          ital: '#7c2d12',
        },
        accent: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        'card-hover': '0 2px 4px 0 rgb(15 23 42 / 0.06), 0 4px 8px -2px rgb(15 23 42 / 0.08)',
        popover: '0 4px 6px -1px rgb(15 23 42 / 0.08), 0 10px 24px -6px rgb(15 23 42 / 0.12)',
      },
    },
  },
  plugins: [],
}
