import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // DeAI dark theme palette
        surface: {
          DEFAULT: '#0f0f10',
          1: '#1a1a1c',
          2: '#242427',
          3: '#2e2e32',
        },
        accent: {
          DEFAULT: '#7c6aff',
          hover:   '#9a8bff',
          dim:     '#3d3480',
        },
        muted: '#6b7280',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'blink': 'blink 1s step-end infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideIn: {
          from: { transform: 'translateX(-8px)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
