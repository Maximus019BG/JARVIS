import { ImageResponse } from 'next/og';
import { ORIGIN_URL } from '~/config/url';

export const runtime = 'nodejs';
export const alt = 'Jarvis Cloud';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const WIDTH = 1200;
const HEIGHT = 630;

/* Grid paper on the same 8px minor / 64px major module as the `bp-grid` utility
   in globals.css. Colours are hex/rgba rather than the oklch() the stylesheet
   uses because Satori's colour parser doesn't handle oklch. The rules are also
   run much brighter than the site's 7% / 15%: an OG card is viewed small and
   usually scaled down by the embedding client, so it needs more contrast than
   the same grid does full-screen. */
const BG = '#131313';
const GRID_MINOR = 'rgba(82, 82, 82, 0.23)';
const GRID_MAJOR = 'rgba(82, 82, 82, 0.40)';
const MINOR_SIZE = 8;
const MAJOR_SIZE = 64;

/* Satori has no support for multi-layer background-image tiling, so the grid
   paper is drawn as absolutely positioned 1px rules instead. */
function gridLines() {
  const lines = [];

  for (let x = 0; x <= WIDTH; x += MINOR_SIZE) {
    lines.push(
      <div
        key={`v-${x}`}
        style={{
          position: 'absolute',
          left: x,
          top: 0,
          width: 1,
          height: HEIGHT,
          background: x % MAJOR_SIZE === 0 ? GRID_MAJOR : GRID_MINOR,
        }}
      />
    );
  }

  for (let y = 0; y <= HEIGHT; y += MINOR_SIZE) {
    lines.push(
      <div
        key={`h-${y}`}
        style={{
          position: 'absolute',
          left: 0,
          top: y,
          width: WIDTH,
          height: 1,
          background: y % MAJOR_SIZE === 0 ? GRID_MAJOR : GRID_MINOR,
        }}
      />
    );
  }

  return lines;
}

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          background: BG,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {gridLines()}

        {/* Satori only parses plain HTML/CSS — next/image renders a client
            component with srcset and cannot be used inside ImageResponse. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${ORIGIN_URL}/icons/JARVIS-brand-logo-v2.svg`}
          width={1032}
          height={270}
          alt="Jarvis Cloud"
          style={{ position: 'relative' }}
        />
      </div>
    ),
    { width: WIDTH, height: HEIGHT }
  );
}
