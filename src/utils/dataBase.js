// The site serves two parallel game-version datasets from one build: the
// default routes serve a pinned "stable" dataset (public/xml, /values,
// /drawable, /raw, /backgrounds), and everything under /dev serves a second,
// always-current "dev" dataset (public/dev/xml, /dev/values, ...). Which one
// a given page load should use is determined purely from the URL - there's no
// server, so this has to be resolved client-side before the first fetch.
const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
const publicUrl = process.env.PUBLIC_URL || '';
const relativePath = (publicUrl && pathname.startsWith(publicUrl))
    ? pathname.slice(publicUrl.length)
    : pathname;

export const IS_DEV = relativePath === '/dev' || relativePath.startsWith('/dev/');

// Prefix for every game-data fetch/asset path (xml, values, drawable, raw,
// backgrounds) - '' for stable (keeps today's paths unchanged), '/dev' for
// the always-current dataset. Purely a data-path prefix, not a route prefix:
// routing itself is handled by BrowserRouter's basename (see index.js), which
// already strips/adds this same segment for every Route/Link automatically.
export const DATA_BASE = IS_DEV ? '/dev' : '';

// Stable and dev are built from different game-repo commits, so they get
// their own REACT_APP_AT_VERSION*-derived value - falls back to the stable
// var if the dev-specific one isn't set (e.g. running locally without a dev
// checkout linked).
export const DISPLAY_VERSION = IS_DEV
    ? (process.env.REACT_APP_AT_VERSION_DEV || process.env.REACT_APP_AT_VERSION)
    : process.env.REACT_APP_AT_VERSION;
