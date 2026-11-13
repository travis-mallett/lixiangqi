import { Resvg } from '@resvg/resvg-js';
// Render into the existing two-piece-box texture; no runtime blur is needed.
// The ellipse is broader and softer than the resting shadow. Leave at least
// three Gaussian sigmas below its silhouette so the 8-bit alpha reaches zero.
import { writeFileSync } from 'node:fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><filter id="blur" filterUnits="userSpaceOnUse" x="0" y="0" width="512" height="512" color-interpolation-filters="sRGB">
    <feGaussianBlur stdDeviation="24"/>
  </filter></defs>
  <ellipse cx="280" cy="312" rx="140" ry="120" fill="#1c160b" fill-opacity="0.25" filter="url(#blur)"/>
</svg>`;
const destination = new URL('../../public/piece/effects/xiangqi-airborne-shadow.png', import.meta.url);
writeFileSync(destination, new Resvg(svg).render().asPng());
