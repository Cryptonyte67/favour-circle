/**
 * The mark: a ring drawn as three arcs, with a tick inside it.
 *
 * The three arcs are the three circle kinds in their own colours — family,
 * friends, community — so the logo is built from the same palette the app uses
 * to tell them apart, rather than being decoration bolted on beside it. The
 * ring is the "circle"; the tick is a favour done.
 *
 * Drawn with strokes and a single path so it stays legible at 20px in a header
 * and at 512px as a submission icon, with no raster assets to keep in sync.
 */

export interface LogoOptions {
  /** Rendered size in px. */
  size?: number;
  /** Override the arc colours (defaults to the CSS custom properties). */
  colors?: [string, string, string];
  /** Tick colour; defaults to currentColor so it inherits text colour. */
  tick?: string;
  /** Solid background circle, for app icons that cannot be transparent. */
  background?: string;
}

export function logoSvg(options: LogoOptions = {}): string {
  const size = options.size ?? 28;
  const [a, b, c] = options.colors ?? [
    'var(--family, #00b78a)',
    'var(--friends, #d98324)',
    'var(--community, #5b5bd6)',
  ];
  const tick = options.tick ?? 'currentColor';

  // Three equal arcs with a small gap between each: circumference of r=27 is
  // ~169.6, so 47 on / 9.5 off repeats cleanly three times.
  const dash = '47 9.5';
  const bg = options.background
    ? `<circle cx="32" cy="32" r="32" fill="${options.background}"/>`
    : '';

  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none"
  xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Favour Circle">
  ${bg}
  <g stroke-width="6" stroke-linecap="round" stroke-dasharray="${dash}">
    <circle cx="32" cy="32" r="27" stroke="${a}" transform="rotate(-90 32 32)"/>
    <circle cx="32" cy="32" r="27" stroke="${b}" transform="rotate(30 32 32)"/>
    <circle cx="32" cy="32" r="27" stroke="${c}" transform="rotate(150 32 32)"/>
  </g>
  <path d="M21 33.5 L28.5 41 L43 25"
    stroke="${tick}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

/** The mark plus the wordmark, for the app header. */
export function logoElement(size = 26): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'logo';
  wrap.innerHTML = logoSvg({ size });
  return wrap;
}
