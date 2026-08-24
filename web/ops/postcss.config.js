// Local, empty PostCSS config -- without this, Vite walks up to the root
// OPS app's postcss.config.js (which loads Tailwind) since this package has
// no config of its own. This package is plain CSS.
export default {
  plugins: {},
}
