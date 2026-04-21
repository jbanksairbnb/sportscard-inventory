/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sc-plum':        { DEFAULT: '#3d1f4a', deep: '#2a1434' },
        'sc-orange':      { DEFAULT: '#e8742c', deep: '#c55a1d' },
        'sc-mustard':     { DEFAULT: '#e5b53d', deep: '#c99528' },
        'sc-teal':        { DEFAULT: '#2d7a6e', deep: '#1f5a50' },
        'sc-rust':        '#c54a2c',
        'sc-cream':       { DEFAULT: '#f5e9d0', warm: '#ecdbb8' },
        'sc-paper':       '#f8ecd0',
        'sc-ink':         { DEFAULT: '#2a1434', soft: '#4a2d5a', mute: '#7a5f8a' },
        'sc-rule':        '#d9b668',
      },
      fontFamily: {
        display: ['"Alfa Slab One"', '"Cooper Black"', 'Georgia', 'serif'],
        script:  ['Pacifico', 'cursive'],
        sans:    ['"DM Sans"', '-apple-system', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
