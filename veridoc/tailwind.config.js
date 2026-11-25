/** Tailwind config - classes are scanned from the SPA (public/app.js) and index.html. */
module.exports = {
  content: ["./public/index.html", "./public/app.js"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#0B1F4B", 800: "#12296a", 700: "#1b3a8a" },
        brand: { 50: "#eef3ff", 100: "#dbe6ff", 500: "#3b66e8", 600: "#1D4ED8", 700: "#1e40af" },
        mint: { 50: "#ecfdf5", 100: "#d1fae5", 500: "#10B981", 600: "#059669" },
      },
      fontFamily: { sans: ['"Inter"', "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(16,24,40,.04), 0 8px 24px -12px rgba(16,24,40,.12)" },
    },
  },
  plugins: [],
};
