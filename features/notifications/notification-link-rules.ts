/**
 * The URL a notification may open, or `null` for none.
 *
 * `Linking.openURL` opens ANY scheme the OS knows: `intent://` starts other
 * apps' activities on Android, `tel:` and `sms:` dial and text, a custom
 * scheme deep-links into whatever app registered it. `item.link` is a string
 * from the API; every policy builds it from a template today
 * (`${env.HTTP_REQUEST}/...`), so nothing user-typed reaches it — but the
 * phone should not be the part that trusts that. Only a web link opens, and
 * it opens in the browser.
 *
 * `http:` as well as `https:`: `HTTP_REQUEST` is http://localhost in
 * development, and neither scheme reaches anything but a browser.
 *
 * A pattern and not `new URL`: React Native's own `URL` does not implement
 * `protocol` or `host` (they throw), and this has to hold on every build.
 */
const WEB_LINK = /^https?:\/\/[^/\\?#@\s]+(?:[/?#]\S*)?$/i;

// Browsers and intent resolvers disagree on what they strip from inside a URL;
// anything with a control character or whitespace in it is simply refused.
const CONTROL_OR_SPACE = /[\u0000- \u007f]/;

function openableNotificationLink(link?: string | null): string | null {
  if (typeof link !== "string") return null;

  const candidate = link.trim();

  if (!candidate || CONTROL_OR_SPACE.test(candidate)) return null;

  return WEB_LINK.test(candidate) ? candidate : null;
}

export { openableNotificationLink };
