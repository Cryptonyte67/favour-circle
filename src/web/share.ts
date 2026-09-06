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

export function capabilities(): ShareCapabilities {
  return {
    webShare: !webShareBroken && typeof navigator !== 'undefined' && 'share' in navigator,
    clipboard: typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText,
    // No feature test exists for URI-scheme handling. Offer it and let the user
    // report; it degrades to nothing happening rather than to a broken state.
    sms: true,
  };
}

export function smsHref(body: string): string {
  // iOS wants sms:&body=, Android wants sms:?body=. Both tolerate the other in
  // most builds, but branching costs nothing.
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  const separator = isApple ? '&' : '?';
  return 'sms:' + separator + 'body=' + encodeURIComponent(body);
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
