// Local, empty PostCSS config -- without this, Vite walks up to the OPS app's root
// postcss.config.js (which loads Tailwind) since this package has no config of its own. This
// site is plain CSS and shares no build tooling with the OPS app.
export default {
  plugins: {},
}
