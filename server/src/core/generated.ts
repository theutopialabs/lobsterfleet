// Stub of the Worker's build-time asset module. The new UI is served from
// web/dist by the Node entry, so the old inlined Preact SPA assets are not used.
// Docs strings stay real-ish so the /docs routes keep working. The SPA HTML is a
// tiny redirect shell that should never be hit (the Node entry serves web/dist
// for "/" before the ported handler sees it).
export const APP_HTML = "<!doctype html><title>lobsterfleet</title>";
export const GHOSTTY_WEB_JS = "";
export const GHOSTTY_BROWSER_EXTERNAL_JS = "";
export const LOGO_PNG_BASE64 = "";
export const OG_IMAGE_PNG_BASE64 = "";
export const SPEC_HTML = "<!doctype html><title>spec</title>";
export const SPEC_MARKDOWN = "# Lobsterfleet spec\n";
export const SPEC_V2_HTML = "<!doctype html><title>spec v2</title>";
export const SPEC_V2_MARKDOWN = "# Lobsterfleet spec v2\n";
