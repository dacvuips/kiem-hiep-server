/** Bảng màu cổ phong: nền nâu đen, viền vàng đồng, điểm nhấn đỏ son, giấy da. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
        serif: ['"Noto Serif"', 'Georgia', '"Times New Roman"', 'serif'],
      },
      colors: {
        ink: { 950: '#0d0907', 900: '#15100c', 850: '#1c1510', 800: '#241a13', 700: '#33251a', 600: '#4a3524' },
        gold: { 100: '#fbf1d6', 200: '#f6e3b0', 300: '#ecd08a', 400: '#d9b264', 500: '#c19443', 600: '#9a7231', 700: '#6e5022' },
        seal: { 400: '#e0514a', 500: '#c3302b', 600: '#a12320', 700: '#7c1916' },
        parch: { 50: '#fbf5e6', 100: '#f3e8cc', 200: '#e6d4a8', 300: '#d2b98a', 700: '#5b4630', 800: '#3e2f20', 900: '#2a1f15' },
      },
      boxShadow: {
        frame: '0 0 0 1px rgba(193,148,67,.55), 0 0 0 4px rgba(13,9,7,.9), 0 0 0 5px rgba(193,148,67,.25), 0 18px 40px -12px rgba(0,0,0,.8)',
        glow: '0 0 24px rgba(217,178,100,.35)',
      },
    },
  },
}
