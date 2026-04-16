import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        chrome: {
          950: '#08090a',
          900: '#0f1011',
          800: '#151618',
          700: '#191a1b',
          600: '#28282c',
        },
        text: {
          primary: '#f7f8f8',
          secondary: '#d0d6e0',
          tertiary: '#8a8f98',
          quaternary: '#62666d',
        },
        accent: {
          DEFAULT: '#5e6ad2',
          bright: '#7170ff',
          hover: '#828fff',
        },
      },
      boxShadow: {
        linear: '0 0 0 1px rgba(255,255,255,0.05), 0 16px 48px rgba(0,0,0,0.35)',
        inset: 'inset 0 0 0 1px rgba(255,255,255,0.04), inset 0 0 18px rgba(0,0,0,0.18)',
      },
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          'SF Pro Display',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: [
          'Berkeley Mono',
          'JetBrains Mono',
          'SFMono-Regular',
          'Consolas',
          'ui-monospace',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
