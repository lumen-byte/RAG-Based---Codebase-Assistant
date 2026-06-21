/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'media',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#171717',
          surface: '#262626',
          card: '#2f2f2f',
          border: '#404040',
          text: '#fafafa',
          muted: '#a3a3a3',
        },
        light: {
          bg: '#ffffff',
          surface: '#f8fafc',
          card: '#ffffff',
          border: '#e5e7eb',
          text: '#111827',
          muted: '#6b7280',
        },
        primary: '#10a37f', // Brand Accent
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
