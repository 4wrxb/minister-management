/**
 * Returns the URL sub-path the SPA is hosted at, normalized for use as both
 * `axios.defaults.baseURL` and React Router's `<BrowserRouter basename>`.
 *
 * Read from `<meta name="app-base">` which the Flask backend injects into
 * index.html at request time, derived from the `URL_PREFIX` env var. The
 * frontend bundle itself is built with `base: './'` so asset URLs are
 * resolved against the corresponding `<base href>` tag the backend also injects.
 *
 * Returns:
 *   - "" when no meta tag is present, when the meta content is empty, or
 *     when it is exactly "/". Both axios and React Router treat "" as
 *     "no prefix", so a single value works for both consumers.
 *   - "/<prefix>" with all trailing slashes stripped otherwise.
 */
export function getAppBase(): string {
  if (typeof document === 'undefined') return ''
  const meta = document.querySelector<HTMLMetaElement>('meta[name="app-base"]')
  const raw = (meta?.content ?? '').trim()
  if (raw === '' || raw === '/') return ''
  return raw.replace(/\/+$/, '')
}
