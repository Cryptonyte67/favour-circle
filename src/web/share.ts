/**
 * Invites.
 *
 * There is no phone-book access here, and there cannot be. The Contact Picker
 * API is Chrome-on-Android only and is not exposed to WebViews, and reading
 * contacts would need READ_CONTACTS in Nimiq Pay's own manifest. navigator.share
 * is also unavailable in Android WebView (long-standing Chromium bug 765923)
 * unless the host app bridges it natively.
 *
 * So every route below has the user pick the recipient themselves, and they are
 * ordered by how reliably they work inside a WebView. Capabilities are probed at
 * runtime, never assumed: whatever is unavailable simply is not offered.
 *
 * This is also the correct design regardless of platform support. Harvesting a
 * contact list to auto-text people is the growth hack that got apps removed, and
 * unsolicited commercial SMS carries real exposure under TCPA and GDPR.
 */

import QRCode from 'qrcode';

export interface ShareCapabilities {
  webShare: boolean;
  clipboard: boolean;
  sms: boolean;
}

/**
 * Probe rather than assume. navigator.share can exist and still throw inside a
 * WebView, so treat the first real failure as the answer and stop offering it.
 */
let webShareBroken = false;
let smsBroken = false;

export function capabilities(): ShareCapabilities {
  return {
    webShare: !webShareBroken && typeof navigator !== 'undefined' && 'share' in navigator,
    clipboard: typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText,
    // Offered until proven otherwise — see trySms. Confirmed not to work inside
    // Nimiq Pay's WebView on iOS, where nothing at all happens on tap.
    sms: !smsBroken,
  };
}

/**
 * Open the SMS composer, and work out whether that actually happened.
 *
 * There is no feature test for URI-scheme handling: `sms:` either hands off to
 * the OS or silently does nothing, and a WebView gives no error either way. The
 * only signal available is whether the page gets backgrounded — if the composer
 * opened, this document is hidden or blurred within a moment. Still here after
 * the timeout means nothing handled it.
 *
 * The heuristic can be wrong in one direction: a WebView that opens the
 * composer without firing visibilitychange looks like a failure. That costs a
 * working button; the reverse would leave a dead one on screen, which is worse.
 */
export function watchSmsHandoff(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onLeave);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('blur', onLeave);
      if (!opened) smsBroken = true;
      resolve(opened);
    };

    const onLeave = () => finish(true);
    const timer = setTimeout(() => finish(false), 1500);

    document.addEventListener('visibilitychange', onLeave);
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('blur', onLeave);
  });
}

/**
 * iOS wants `sms:&body=`, Android wants `sms:?body=`, and neither reliably
 * accepts the other.
 *
 * Detection deliberately does not rely on the user agent alone. An app
 * embedding a WebView can set any UA it likes, and Nimiq Pay's does not
 * necessarily contain "iPhone" — which silently produced the Android form on an
 * iPhone, where it does nothing at all. `navigator.vendor` stays "Apple
 * Computer, Inc." in WKWebView regardless of the UA, and touch-capable
 * Macintosh covers iPads reporting as desktop.
 */
export function isAppleWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (navigator.vendor === 'Apple Computer, Inc.') return true;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  const platform = (navigator as Navigator & { platform?: string }).platform ?? '';
  return /iPad|iPhone|iPod/.test(platform) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function smsHref(body: string): string {
  return 'sms:' + (isAppleWebKit() ? '&' : '?') + 'body=' + encodeURIComponent(body);
}

export async function tryWebShare(title: string, text: string, url: string): Promise<boolean> {
  if (!capabilities().webShare) return false;
  try {
    await navigator.share({ title, text, url });
    return true;
  } catch (err) {
    // AbortError means the user dismissed the sheet, which is not a capability
    // problem. Anything else means the WebView cannot do this; stop offering it.
    if ((err as Error).name !== 'AbortError') {
      console.warn('[share] navigator.share unavailable in this WebView', err);
      webShareBroken = true;
    }
    return false;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // execCommand is deprecated but is the only fallback some WebViews have.
    try {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  }
}

/** QR is the one route that cannot fail, and chores are usually assigned in person. */
export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 240,
    margin: 1,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}

export function inviteUrl(origin: string, code: string): string {
  return origin + '/join/' + code;
}

export function taskUrl(origin: string, taskId: string): string {
  return origin + '/t/' + taskId;
}
