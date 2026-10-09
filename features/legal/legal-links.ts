/**
 * Where the app's privacy policy and terms of use live.
 *
 * Google Play requires the privacy policy to be reachable from inside an app
 * that collects location, and the app had no link to it at all. The pages
 * are the web's `/legal/<slug>` (trajetto-ui `src/content/legal`), served by
 * the same web application the app already links to, so the address is
 * derived from `EXPO_PUBLIC_WEB_APPLICATION_URL` rather than configured
 * twice.
 *
 * Pure: no `URL` (React Native's is partial), a pattern for the origin.
 */

type LegalDocument = "privacidade" | "termos";

const LEGAL_LINKS: ReadonlyArray<{ document: LegalDocument; label: string }> = [
  { document: "privacidade", label: "Política de Privacidade" },
  { document: "termos", label: "Termos de Uso" },
];

const ORIGIN = /^(https?:\/\/[^/?#\s]+)/i;

/**
 * The page of `document` on the web application at `webApplicationUrl`
 * (which may point at any page of it, `/login` included). Null when the
 * build has no web address, so the link is not offered.
 */
function legalDocumentUrl(
  webApplicationUrl: string | null | undefined,
  document: LegalDocument,
): string | null {
  const origin = webApplicationUrl?.trim().match(ORIGIN)?.[1];

  return origin ? `${origin}/legal/${document}` : null;
}

export { LEGAL_LINKS, legalDocumentUrl };
export type { LegalDocument };
