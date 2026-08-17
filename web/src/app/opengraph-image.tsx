import { ImageResponse } from 'next/og';

export const runtime = 'edge'; 
export const alt = 'Jarvis Cloud';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'oklch(0.185 0 0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 60,
        fontWeight: 'bold',
        color: 'white',
      }}
    >
      JARVIS
    </div>,
    { width: 1200, height: 630 }
  );
}