// All drawn artwork for the app: icons, the logo, the sunset landscapes, avatars and the mastery ring.
// Everything is inline SVG, so nothing extra is downloaded and it stays sharp on any screen.
import React, { useEffect, useId } from 'react';
import { T, toneHex, skyTopHex, barHex } from './theme.js';

/* ---------- line icons ---------- */
const PATHS = {
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  phone: 'M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM11 18.5h2',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  play: 'M8 5.5v13l11-6.5z',
  camera: 'M4 8.5h3l1.6-2.5h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.500a1 1 0 0 1 1-1zM12 16.200a3.200 3.200 0 1 0 0-6.400 3.200 3.200 0 0 0 0 6.400z',
  image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3.500 16l4.500-4.500 3.500 3.500 3-3 6 6M15.500 9.500h.01',
  file: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
  text: 'M4 6h16M4 11h16M4 16h9',
  shuffle: 'M3 7h3.500c2 0 3.200 1 4.300 2.800l2.400 4.400C14.300 16 15.500 17 17.500 17H21M18 14l3 3-3 3M3 17h3.500c1.300 0 2.300-.400 3.100-1.200M21 7h-3.500c-1.300 0-2.300.400-3.100 1.200M18 4l3 3-3 3',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 12.500l9 5 9-5M3 17l9 5 9-5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  circle: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  mic: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.500 11a6.500 6.500 0 0 0 13 0M12 17.500V21M9 21h6',
  speaker: 'M4 9.500h3l5-4v13l-5-4H4zM16 9a4 4 0 0 1 0 6M18.500 6.500a7.500 7.500 0 0 1 0 11',
  pause: 'M8 5v14M16 5v14',
  repeat: 'M4 12a8 8 0 0 1 13.700-5.700L20 8.500M20 4v4.500h-4.500M20 12a8 8 0 0 1-13.700 5.700L4 15.500M4 20v-4.500h4.500',
  skip: 'M5 5.500v13l10-6.500zM19 5v14',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  eye: 'M2 12s3.600-6.500 10-6.500S22 12 22 12s-3.600 6.500-10 6.500S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  tap: 'M9 11V5.500a1.500 1.500 0 0 1 3 0V11l4.600.900a2 2 0 0 1 1.600 2.300l-.700 4.300A2 2 0 0 1 15.500 20h-4a2 2 0 0 1-1.600-.800L6.500 14.500a1.300 1.300 0 0 1 2-1.600L9 13.500',
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4.500v-5.500h-5V20H5a1 1 0 0 1-1-1z',
  chart: 'M5 20v-6M12 20V5M19 20v-9',
  edit: 'M4 20h4l11-11-4-4L4 16zM13.500 6.500l4 4',
  trash: 'M5 7h14M10 7V4.500h4V7M7 7l1 13h8l1-13',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  key: 'M12.500 9a4.500 4.500 0 1 1-9 0 4.500 4.500 0 0 1 9 0zM11.200 12.200L20.500 21.500M17 18l2.500-2.500M14.200 15.200l2-2',
  sparkle: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800zM19 16l.700 2 2 .700-2 .700-.700 2-.700-2-2-.700 2-.700z',
  list: 'M9 6h11M9 12h11M9 18h11M4.500 6h.01M4.500 12h.01M4.500 18h.01',
  alert: 'M12 4l9 16H3zM12 10v4.500M12 17.500h.01',
  users: 'M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM2.500 20a6.500 6.500 0 0 1 13 0M16 4.500a3.500 3.500 0 0 1 0 6.500M18 14.500a6.500 6.500 0 0 1 3.500 5.500',
  gear: 'M10.21 5.34L10.50 2.52L13.50 2.52L13.79 5.34A6.9 6.9 0 0 1 15.45 6.02L15.45 6.02L17.64 4.23L19.77 6.36L17.98 8.55A6.9 6.9 0 0 1 18.66 10.21L18.66 10.21L21.48 10.50L21.48 13.50L18.66 13.79A6.9 6.9 0 0 1 17.98 15.45L17.98 15.45L19.77 17.64L17.64 19.77L15.45 17.98A6.9 6.9 0 0 1 13.79 18.66L13.79 18.66L13.50 21.48L10.50 21.48L10.21 18.66A6.9 6.9 0 0 1 8.55 17.98L8.55 17.98L6.36 19.77L4.23 17.64L6.02 15.45A6.9 6.9 0 0 1 5.34 13.79L5.34 13.79L2.52 13.50L2.52 10.50L5.34 10.21A6.9 6.9 0 0 1 6.02 8.55L6.02 8.55L4.23 6.36L6.36 4.23L8.55 6.02A6.9 6.9 0 0 1 10.21 5.34ZM15.2 12a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 0 1 6.4 0z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  unlock: 'M7 11V8a5 5 0 0 1 9.6-2M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
  fit: 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5M9 9h6v6H9z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM12 15v2.500',
  flask: 'M9.500 3h5M10 3v6L4.500 19a1.500 1.500 0 0 0 1.300 2h12.400a1.500 1.500 0 0 0 1.300-2L14 9V3M7.500 15h9'
};
const FILLED = new Set(['play', 'skip']);

export function Icon({ name, size = 22, className = '' }) {
  const filled = FILLED.has(name);
  return (
    <svg className={'ic ' + className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 1.2 : 2.1} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

/* ---------- logo: an open book in sky-to-violet ---------- */
export function BookLogo({ size = 96 }) {
  const id = useId();
  return (
    <svg width={size} height={size * 0.82} viewBox="0 0 120 98" aria-hidden="true" className="booklogo">
      <defs>
        <linearGradient id={id + 'l'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: T('#35D2F5') }} /><stop offset=".55" style={{ stopColor: T('#4F7BF2') }} /><stop offset="1" style={{ stopColor: T('#6D4BEA') }} /></linearGradient>
        <linearGradient id={id + 'r'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: T('#6F6CF5') }} /><stop offset=".6" style={{ stopColor: T('#8C4FEA') }} /><stop offset="1" style={{ stopColor: T('#C56BF3') }} /></linearGradient>
        <linearGradient id={id + 'p'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#5A46D8') }} /><stop offset="1" style={{ stopColor: T('#B467F0') }} /></linearGradient>
      </defs>
      <path d="M8 76c16-7 34-6 50 6l4 12-4-4C42 80 24 79 8 86z" fill={`url(#${id}p)`} opacity=".9" />
      <path d="M112 76c-16-7-34-6-50 6l-4 12 4-4c16-10 34-11 50-4z" fill={`url(#${id}p)`} opacity=".9" />
      <path d="M22 8c13-6 28-3 38 12v66C48 73 30 70 10 76z" fill={`url(#${id}l)`} stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
      <path d="M98 8C85 2 70 5 60 20v66c12-13 30-16 50-10z" fill={`url(#${id}r)`} stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
      <path d="M27 20c9-3 18-1 25 7M24 34c10-3 20-1 28 6" stroke="#fff" strokeOpacity=".45" strokeWidth="2.500" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- landscapes ---------- */
const r1 = (n) => Math.round(n * 10) / 10;
function pine(x, y, h, w = h * 0.46) {
  let d = '';
  for (let i = 0; i < 4; i++) {
    const top = y - h + (h * 0.72 * i) / 4;
    const bot = top + h * 0.4;
    const half = (w / 2) * (0.42 + (0.58 * (i + 1)) / 4);
    d += `M${r1(x)} ${r1(top)}L${r1(x + half)} ${r1(bot)}L${r1(x - half)} ${r1(bot)}Z`;
  }
  return d + `M${r1(x - w * 0.06)} ${r1(y - h * 0.1)}h${r1(w * 0.12)}v${r1(h * 0.1)}h${r1(-w * 0.12)}Z`;
}
const pines = (list) => list.map(([x, y, h]) => pine(x, y, h)).join('');

const THEME = { peaks: '#4E55C6', haze: '#6257DC' };
// Sets the phone's status bar colour to match the top of the picture while it is on screen.
function useThemeColor(color) {
  useEffect(() => {
    if (!color) return undefined;
    const m = document.querySelector('meta[name="theme-color"]');
    if (!m) return undefined;
    const old = m.getAttribute('content');
    m.setAttribute('content', barHex(toneHex(color)));
    return () => m.setAttribute('content', skyTopHex());
  }, [color]);
}

// kind: 'peaks' (sunset sky and mountains behind a header), 'lake' (lake and forest along the bottom),
// 'haze' (a plain violet glow behind a header), 'waves' (soft flowing bands).
export function Scenery({ kind = 'peaks' }) {
  const id = useId();
  useThemeColor(THEME[kind]);
  if (kind === 'haze') return <div className="scene haze" aria-hidden="true" />;
  if (kind === 'waves') return (
    <div className="scene waves" aria-hidden="true">
      <svg viewBox="0 0 400 300" preserveAspectRatio="none">
        <defs>
          <linearGradient id={id + 'a'} x1="0" y1="0" x2="1" y2="0"><stop offset="0" style={{ stopColor: T('#BFE3FF') }} /><stop offset=".5" style={{ stopColor: T('#B9A8F7') }} /><stop offset="1" style={{ stopColor: T('#E3B5F5') }} /></linearGradient>
          <linearGradient id={id + 'b'} x1="0" y1="0" x2="1" y2="0"><stop offset="0" style={{ stopColor: T('#D5CCFB') }} /><stop offset=".6" style={{ stopColor: T('#C7B4F8') }} /><stop offset="1" style={{ stopColor: T('#BFD2FB') }} /></linearGradient>
        </defs>
        <path d="M0 150C70 90 130 120 200 160s140 20 200-60v200H0z" fill={`url(#${id}a)`} opacity=".55" />
        <path d="M0 190c80-50 150-10 220 10s130-10 180-50v150H0z" fill={`url(#${id}b)`} opacity=".7" />
        <path d="M0 230c90-30 170 0 240 6s120-12 160-30v94H0z" opacity=".9" style={{ fill: T('#F1ECFF') }} />
      </svg>
    </div>
  );
  if (kind === 'lake') return (
    <div className="scene lake" aria-hidden="true">
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice">
        <defs>
          <radialGradient id={id + 'g'} cx="200" cy="134" r="170" gradientUnits="userSpaceOnUse"><stop offset="0" style={{ stopColor: T('#FFF3C4') }} /><stop offset=".22" stopOpacity=".9" style={{ stopColor: T('#FFDCA6') }} /><stop offset=".58" stopOpacity=".42" style={{ stopColor: T('#F9B4CF') }} /><stop offset="1" stopOpacity="0" style={{ stopColor: T('#E9B8F0') }} /></radialGradient>
          <linearGradient id={id + 'f'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#D2ADEF') }} /><stop offset="1" style={{ stopColor: T('#A68CE5') }} /></linearGradient>
          <linearGradient id={id + 'm'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#957DE0') }} /><stop offset="1" style={{ stopColor: T('#6A5FCB') }} /></linearGradient>
          <linearGradient id={id + 'w'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#FBD3C6') }} /><stop offset=".45" style={{ stopColor: T('#C9ACEB') }} /><stop offset="1" style={{ stopColor: T('#7C80D6') }} /></linearGradient>
          <linearGradient id={id + 'h'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#5856B4') }} /><stop offset="1" style={{ stopColor: T('#3A3A8A') }} /></linearGradient>
          <linearGradient id={id + 'e'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#2C3274') }} /><stop offset="1" style={{ stopColor: T('#181D4A') }} /></linearGradient>
          <linearGradient id={id + 'x'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity=".34" /></linearGradient>
        </defs>
        <rect width="400" height="300" fill={`url(#${id}g)`} />
        <g opacity=".55" style={{ fill: T('#FFD3E2') }}><ellipse cx="76" cy="78" rx="44" ry="6" /><ellipse cx="112" cy="86" rx="30" ry="4" /><ellipse cx="330" cy="70" rx="40" ry="6" /></g>
        <circle cx="200" cy="136" r="25" style={{ fill: T('#FFF7D6') }} />
        <path d="M0 152l30-24 28 16 42-48 40 44 28-16 32 26 32-24 30 16 44-54 44 50 26-18 24 16v64H0z" fill={`url(#${id}f)`} />
        <path d="M100 96l40 44h-17l-11-15 6-8-13-10zM306 88l-44 54h19l11-18-6-8 14-12z" opacity=".85" style={{ fill: T('#FFC6B4') }} />
        <rect y="150" width="400" height="34" fill={`url(#${id}x)`} />
        <path d="M0 178l40-28 36 18 44-28 50 38 30-8 36 10 50-38 44 28 34-22 36 24v40H0z" fill={`url(#${id}m)`} />
        <path d="M120 140l50 38h-22l-12-12 4-6-14-10zM286 142l-50 38h24l12-13-5-6 14-10z" opacity=".55" style={{ fill: T('#F0A6CC') }} />
        <rect y="184" width="400" height="60" fill={`url(#${id}w)`} />
        <g opacity=".8" style={{ fill: T('#FFF4D0') }}><rect x="182" y="189" width="36" height="3.500" rx="1.700" /><rect x="172" y="198" width="56" height="3.500" rx="1.700" /><rect x="186" y="207" width="28" height="3.500" rx="1.700" /><rect x="192" y="216" width="16" height="3" rx="1.500" /></g>
        <path d="M0 192c50-8 110-2 158 14-48 8-108 8-158 18z" fill={`url(#${id}h)`} />
        <path d="M400 190c-50-8-108-2-152 14 44 8 102 8 152 16z" fill={`url(#${id}h)`} />
        <path d={pines([[14, 200, 30], [34, 202, 22], [56, 202, 34], [80, 204, 20], [104, 207, 24], [296, 205, 22], [320, 203, 30], [344, 201, 22], [366, 200, 34], [390, 199, 26]])} style={{ fill: T('#34398A') }} />
        <path d="M0 246c70-18 140-14 200-2s130 6 200-12v68H0z" fill={`url(#${id}e)`} />
        <path d={pines([[12, 266, 84], [46, 272, 54], [84, 262, 68], [124, 274, 40], [280, 272, 44], [316, 260, 66], [352, 268, 52], [388, 258, 88]])} style={{ fill: T('#1D2456') }} />
        <path d="M16 286l4-13 3 13zM32 288l5-17 3 17zM60 290l4-12 3 12zM322 290l4-12 3 12zM350 288l5-16 3 16zM378 286l4-14 3 14z" style={{ fill: T('#EBC164') }} />
      </svg>
    </div>
  );
  return (
    <div className="scene peaks" aria-hidden="true">
      <svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id={id + 's'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#4E55C6') }} /><stop offset=".32" style={{ stopColor: T('#7462D8') }} /><stop offset=".58" style={{ stopColor: T('#B885E0') }} /><stop offset=".78" style={{ stopColor: T('#F2A6C6') }} /><stop offset="1" style={{ stopColor: T('#FFD3A6') }} /></linearGradient>
          <radialGradient id={id + 'g'} cx="312" cy="156" r="120" gradientUnits="userSpaceOnUse"><stop offset="0" stopOpacity=".95" style={{ stopColor: T('#FFF1B8') }} /><stop offset=".4" stopOpacity=".5" style={{ stopColor: T('#FFC99E') }} /><stop offset="1" stopOpacity="0" style={{ stopColor: T('#FFC99E') }} /></radialGradient>
          <linearGradient id={id + 'f'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#C9A5EC') }} /><stop offset="1" style={{ stopColor: T('#A587E4') }} /></linearGradient>
          <linearGradient id={id + 'p'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: T('#9D7BE4') }} /><stop offset="1" style={{ stopColor: T('#5B4FB9') }} /></linearGradient>
          <linearGradient id={id + 'l'} x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: T('#FFC0A6') }} /><stop offset="1" style={{ stopColor: T('#DD8CCB') }} /></linearGradient>
        </defs>
        <rect width="400" height="260" fill={`url(#${id}s)`} />
        <rect width="400" height="260" fill={`url(#${id}g)`} />
        <g opacity=".5" style={{ fill: T('#FFC6DD') }}><ellipse cx="66" cy="92" rx="46" ry="7" /><ellipse cx="104" cy="101" rx="32" ry="5" /><ellipse cx="352" cy="88" rx="42" ry="6" /></g>
        <circle cx="312" cy="158" r="18" style={{ fill: T('#FFF6D2') }} />
        <path d="M0 180l40-28 30 16 42-34 38 36 46-28 40 32 44-26 42 24 40-26 38 20v94H0z" fill={`url(#${id}f)`} opacity=".92" />
        <path d="M-30 224l92-96 88 96z" style={{ fill: T('#7B66D2') }} />
        <path d="M62 128l88 96h-44l-18-34 8-10-22-26z" opacity=".6" style={{ fill: T('#E79CC4') }} />
        <path d="M30 224L164 82l136 142z" fill={`url(#${id}p)`} />
        <path d="M164 82l136 142h-76l-26-46 12-12-30-36 10-16z" fill={`url(#${id}l)`} opacity=".92" />
        <path d="M0 212l46-20 50 16 54-14 60 22 52-20 58 18 40-14 40 12v48H0z" style={{ fill: T('#5148B4') }} />
        <path d="M0 236l70-14 80 12 90-10 80 12 80-14v38H0z" style={{ fill: T('#3B3A93') }} />
        <path d={pines([[298, 240, 26], [316, 244, 20], [336, 238, 30], [358, 243, 22], [378, 237, 30], [396, 242, 24], [10, 244, 22], [28, 240, 28], [48, 245, 18]])} style={{ fill: T('#2A2D72') }} />
      </svg>
    </div>
  );
}

/* ---------- round avatars: each person gets a small landscape ---------- */
const AVATAR_OF = { kid1: 'peak', kid2: 'wave', kid3: 'forest', test: 'lab' };
const AVATAR_ORDER = ['peak', 'wave', 'forest'];
export function avatarKind(profile, index = 0) {
  return AVATAR_OF[profile?.id] || AVATAR_ORDER[index % 3];
}
export function Avatar({ kind = 'peak', size = 72, className = '' }) {
  const id = useId();
  const clip = `url(#${id}c)`;
  let art;
  if (kind === 'wave') art = (
    <>
      <rect width="80" height="80" fill={`url(#${id}a)`} />
      <g opacity=".9" style={{ fill: T('#FFD9E6') }}><ellipse cx="20" cy="26" rx="14" ry="4" /><ellipse cx="30" cy="31" rx="10" ry="3" /></g>
      <circle cx="52" cy="40" r="5" style={{ fill: T('#FFF3C4') }} />
      <path d="M0 44c14-4 26-4 40 0s26 4 40 0v36H0z" style={{ fill: T('#3E8FE0') }} />
      <path d="M30 80c-4-24 8-46 30-50 10-2 18 4 20 10-6-4-14-2-16 6 8-2 14 4 16 12v22z" style={{ fill: T('#1F6FD0') }} />
      <path d="M60 30c10-2 18 4 20 10-6-4-14-2-16 6-6-4-14-2-18 6 0-12 6-20 14-22z" style={{ fill: T('#EAF6FF') }} />
      <path d="M0 62c16-6 30-4 44 2s24 6 36 2v14H0z" opacity=".85" style={{ fill: T('#5FC3F2') }} />
    </>
  );
  else if (kind === 'forest') art = (
    <>
      <rect width="80" height="80" fill={`url(#${id}b)`} />
      <circle cx="26" cy="40" r="6" style={{ fill: T('#FFF3C4') }} />
      <path d="M0 52l18-14 14 10 16-12 32 22v22H0z" opacity=".9" style={{ fill: T('#B58BDD') }} />
      <path d="M0 62c20-8 50-8 80 0v18H0z" style={{ fill: T('#8FB35A') }} />
      <path d={pines([[16, 70, 30], [34, 74, 22], [56, 72, 44], [72, 74, 26]])} style={{ fill: T('#1F5B4A') }} />
      <path d="M0 72c26-6 54-6 80 0v8H0z" opacity=".9" style={{ fill: T('#E0B24F') }} />
    </>
  );
  else if (kind === 'lab') art = (
    <>
      <rect width="80" height="80" fill={`url(#${id}d)`} />
      <circle cx="40" cy="34" r="12" style={{ fill: T('#FFF3C4') }} />
      <path d="M0 50c20-8 40-8 80 2v28H0z" style={{ fill: T('#F0A24A') }} />
      <path d="M0 60c30-10 50-6 80 0v20H0z" style={{ fill: T('#D97A3A') }} />
      <path d={pines([[18, 70, 20], [62, 72, 24]])} style={{ fill: T('#8A4420') }} />
    </>
  );
  else art = (
    <>
      <rect width="80" height="80" fill={`url(#${id}a2)`} />
      <circle cx="58" cy="42" r="6" style={{ fill: T('#FFF3C4') }} />
      <path d="M0 56l22-18 12 8 12-14 34 26v22H0z" style={{ fill: T('#8E73DD') }} />
      <path d="M46 32l10 14-6 2 12 10H48l-6-10 6-4z" opacity=".9" style={{ fill: T('#FFB7A1') }} />
      <path d="M0 60l24-8 26 8 30-10v30H0z" style={{ fill: T('#5148B0') }} />
      <path d={pines([[10, 72, 20], [22, 74, 14], [62, 73, 18], [74, 72, 22]])} style={{ fill: T('#27306E') }} />
    </>
  );
  return (
    <svg className={'avatar-art ' + className} width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        <clipPath id={id + 'c'}><circle cx="40" cy="40" r="40" /></clipPath>
        <linearGradient id={id + 'a'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#4F8DF0') }} /><stop offset=".55" style={{ stopColor: T('#F3A9CB') }} /><stop offset="1" style={{ stopColor: T('#FFD9A8') }} /></linearGradient>
        <linearGradient id={id + 'a2'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#B88BEA') }} /><stop offset=".5" style={{ stopColor: T('#F6A7C4') }} /><stop offset="1" style={{ stopColor: T('#FFD08F') }} /></linearGradient>
        <linearGradient id={id + 'b'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#B695EE') }} /><stop offset=".6" style={{ stopColor: T('#F7B5C8') }} /><stop offset="1" style={{ stopColor: T('#FFDFA6') }} /></linearGradient>
        <linearGradient id={id + 'd'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: T('#F38BA8') }} /><stop offset=".6" style={{ stopColor: T('#FFC27A') }} /><stop offset="1" style={{ stopColor: T('#FFE7A8') }} /></linearGradient>
      </defs>
      <g clipPath={clip}>{art}</g>
    </svg>
  );
}

/* ---------- pictures on the four big buttons ---------- */
export function TileArt({ kind }) {
  const id = useId();
  const g = (suffix, a, b, x2 = 1, y2 = 1) => <linearGradient id={id + suffix} x1="0" y1="0" x2={x2} y2={y2}><stop offset="0" style={{ stopColor: T(a) }} /><stop offset="1" style={{ stopColor: T(b) }} /></linearGradient>;
  const u = (s) => `url(#${id}${s})`;
  if (kind === 'flash') return (
    <svg className="tile-art" viewBox="0 0 96 64" aria-hidden="true">
      <defs>{g('a', '#C9A6F8', '#9A6BEC')}{g('b', '#9F6FF0', '#5E3AD6')}{g('c', '#FFFFFF', '#E9E0FF')}</defs>
      <rect x="44" y="8" width="38" height="44" rx="9" fill={u('a')} transform="rotate(14 63 30)" />
      <rect x="14" y="6" width="42" height="46" rx="10" fill={u('b')} transform="rotate(-12 35 29)" />
      <rect x="27" y="12" width="40" height="42" rx="10" fill={u('c')} transform="rotate(-4 47 33)" />
      <path d="M40 34l7-6 7 6M41 39h12" strokeWidth="3.400" strokeLinecap="round" strokeLinejoin="round" fill="none" transform="rotate(-4 47 33)" style={{ stroke: T('#8B63EA') }} />
    </svg>
  );
  if (kind === 'quiz') return (
    <svg className="tile-art" viewBox="0 0 96 64" aria-hidden="true">
      <defs>{g('a', '#F4FAFF', '#CFE6FF')}{g('b', '#5AB7FF', '#2F6BE8')}</defs>
      <rect x="22" y="5" width="44" height="54" rx="9" fill={u('a')} strokeWidth="3" style={{ stroke: T('#3F8DF2') }} />
      <path d="M31 20l3 3 5-6M31 33l3 3 5-6M31 46l3 3 5-6" strokeWidth="2.800" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ stroke: T('#2F7BEB') }} />
      <path d="M45 20h13M45 33h13M45 46h8" strokeWidth="3" strokeLinecap="round" style={{ stroke: T('#6FB4F8') }} />
      <path d="M78 22l8 6-22 28-11 5 3-12z" fill={u('b')} />
      <path d="M56 49l8 6-11 5z" style={{ fill: T('#1E3F9A') }} />
      <path d="M78 22l8 6 3-4a5 5 0 0 0-8-6z" style={{ fill: T('#9BD3FF') }} />
    </svg>
  );
  if (kind === 'missed') return (
    <svg className="tile-art" viewBox="0 0 96 64" aria-hidden="true">
      <defs>{g('a', '#FFFFFF', '#FFF1CC')}{g('b', '#FFC23D', '#F28A1E')}</defs>
      <rect x="10" y="8" width="76" height="48" rx="11" fill={u('a')} strokeWidth="3" style={{ stroke: T('#F2A22E') }} />
      <path d="M20 22h20M62 22h14M20 34h10M52 34h24M20 46h26" strokeWidth="4" strokeLinecap="round" style={{ stroke: T('#F6C46A') }} />
      <rect x="43" y="28" width="26" height="12" rx="6" fill={u('b')} />
      <path d="M48 34h4M56 34h4M63 34h2" strokeWidth="2.400" strokeLinecap="round" style={{ stroke: T('#FFFFFF') }} />
    </svg>
  );
  if (kind === 'voice') return (
    <svg className="tile-art" viewBox="0 0 96 64" aria-hidden="true">
      <defs>{g('a', '#FFB45E', '#F2672E', 0, 1)}</defs>
      <rect x="39" y="4" width="18" height="34" rx="9" fill={u('a')} />
      <path d="M32 28a16 16 0 0 0 32 0M48 44v12M39 57h18" strokeWidth="3.600" strokeLinecap="round" fill="none" style={{ stroke: T('#F0702F') }} />
      <path d="M8 26v8M15 20v20M22 24v12M74 24v12M81 20v20M88 26v8" strokeWidth="3.400" strokeLinecap="round" style={{ stroke: T('#FF9B52') }} />
    </svg>
  );
  return (
    <svg className="tile-art" viewBox="0 0 96 64" aria-hidden="true">
      <defs>{g('a', '#19A37A', '#0F7F68', 0, 1)}{g('b', '#57DDA9', '#1FB583', 0, 1)}</defs>
      <path d="M20 14a6 6 0 0 1 6-6h16l7 8h21a6 6 0 0 1 6 6v30a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6z" fill={u('a')} />
      <path d="M30 26h48a5 5 0 0 1 5 6l-5 21a6 6 0 0 1-6 5H22a4 4 0 0 1-4-5l6-22a6 6 0 0 1 6-5z" fill={u('b')} />
    </svg>
  );
}

/* ---------- small picture for each project, picked from words in its name ---------- */
const SUBJECTS = [
  [/bible|gospel|doctrine|scripture|psalm|church|faith|theolog/i, 'bible'],
  [/histor|empire|civili[sz]|rome|roman|greek|greece|war|ancient|government|civics|geograph/i, 'history'],
  [/bio|plant|photosynth|cell|anatom|science|chem|physic|nature|earth|ecolog/i, 'science'],
  [/math|algebra|geometr|calculus|number|fraction|equation|arithmet/i, 'math'],
  [/english|grammar|vocab|spelling|literature|reading|writing|language|spanish|french|latin|russian|german/i, 'words']
];
export function subjectOf(name) {
  const hit = SUBJECTS.find(([re]) => re.test(name || ''));
  return hit ? hit[1] : 'book';
}
export function ProjectThumb({ name }) {
  const id = useId();
  const s = subjectOf(name);
  const sky = { bible: ['#F9D48B', '#C98A4B'], history: ['#8EC5FF', '#F8C9B0'], science: ['#B6E88A', '#3FA45B'], math: ['#9CB8FF', '#7A63E0'], words: ['#F6B4D6', '#A873E8'], book: ['#B9A8F7', '#6F58DE'] }[s];
  let art;
  if (s === 'bible') art = (<><path d="M32 4l22 38H10z" opacity=".42" style={{ fill: T('#FFF6D0') }} /><path d="M9 38c8-4 16-3 23 3v15c-7-6-15-7-23-3zM55 38c-8-4-16-3-23 3v15c7-6 15-7 23-3z" strokeWidth="1.600" strokeLinejoin="round" style={{ fill: T('#FFFAEE'), stroke: T('#8A5A2B') }} /><path d="M13 43c5-2 10-1 15 3M13 48c5-2 10-1 15 3M36 46c5-4 10-5 15-3M36 51c5-4 10-5 15-3" strokeWidth="1.300" fill="none" strokeLinecap="round" style={{ stroke: T('#C9A77A') }} /></>);
  else if (s === 'history') art = (<><path d="M0 50h64v14H0z" style={{ fill: T('#7FB069') }} /><path d="M12 22h40l-4-8H16z" style={{ fill: T('#F4E3C3') }} /><path d="M10 22h44v5H10zM10 48h44v5H10z" style={{ fill: T('#E9D2A8') }} /><path d="M15 27h5v21h-5zM25 27h5v21h-5zM35 27h5v21h-5zM45 27h5v21h-5z" style={{ fill: T('#F7EAD0') }} /></>);
  else if (s === 'science') art = (<><path d="M32 54C30 40 22 30 8 28c2 14 10 24 24 26zM32 54c2-18 12-30 26-34-2 18-10 30-26 34z" style={{ fill: T('#E7FBB8') }} /><path d="M32 54c2-10 8-18 16-24M32 54c-3-8-8-14-14-18" strokeWidth="1.800" fill="none" strokeLinecap="round" style={{ stroke: T('#3F8F4A') }} /></>);
  else if (s === 'math') art = (<><path d="M16 22h12M22 16v12M38 18l8 8M46 18l-8 8M16 44h12M38 40h8M38 47h8" stroke="#fff" strokeWidth="4" strokeLinecap="round" /></>);
  else if (s === 'words') art = (<><path d="M14 46l9-26h4l9 26M18 37h14" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M42 22v24M42 34c0-5 10-5 10 2s-10 7-10 2" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" /></>);
  else art = (<><path d="M10 20c8-4 15-3 22 3v26c-7-6-14-7-22-3zM54 20c-8-4-15-3-22 3v26c7-6 14-7 22-3z" fill="#fff" opacity=".95" /><path d="M15 27c4-1 8 0 12 3M15 34c4-1 8 0 12 3M37 30c4-3 8-4 12-3M37 37c4-3 8-4 12-3" strokeWidth="1.800" fill="none" strokeLinecap="round" style={{ stroke: T('#9E8BEA') }} /></>);
  return (
    <svg className="thumb-art" viewBox="0 0 64 64" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: T(sky[0]) }} /><stop offset="1" style={{ stopColor: T(sky[1]) }} /></linearGradient></defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      {art}
    </svg>
  );
}

/* ---------- mastery ring ---------- */
export function Ring({ percent = 0, size = 132, label = 'Mastery' }) {
  const id = useId();
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const r = 44, c = 2 * Math.PI * r;
  const done = p === 100;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${p}% ${label.toLowerCase()}`}>
      <svg viewBox="0 0 110 110" aria-hidden="true">
        <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1">{done ? (<><stop offset="0" style={{ stopColor: T('#3FD6A3') }} /><stop offset="1" style={{ stopColor: T('#0E9F6E') }} /></>) : (<><stop offset="0" style={{ stopColor: T('#B77BF6') }} /><stop offset="1" style={{ stopColor: T('#5B3DE0') }} /></>)}</linearGradient></defs>
        <circle cx="55" cy="55" r={r} fill="none" strokeWidth="13" style={{ stroke: T('#E4DEFA') }} />
        {p > 0 && <circle cx="55" cy="55" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`} transform="rotate(-90 55 55)" />}
        <circle cx="55" cy="55" r="34" fill="#fff" />
      </svg>
      <span className="ring-text"><b>{p}%</b><small>{label}</small></span>
    </div>
  );
}
