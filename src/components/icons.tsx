import React from "react";

/**
 * 单文件图标集（描边风格，随 currentColor）。
 * 供侧边栏、按钮与页面共用，保持与既有 hermes 壳层同一视觉语言。
 */
const PATHS: Record<string, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  flask: (
    <>
      <path d="M9 3v5l-5.2 8.6A2.2 2.2 0 0 0 5.7 20h12.6a2.2 2.2 0 0 0 1.9-3.4L15 8V3" />
      <path d="M7 14h10M8 3h8" />
    </>
  ),
  chat: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 12.5z" />,
  nodes: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="m7.8 7.2 2.8 8M16.2 7.2l-2.8 8M8.5 6h7" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21z" />
      <path d="M5 4.5v16M9 6h6M9 10h6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19V5M4 19h17" />
      <path d="m7 15 3-4 3 2 5-7" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-1.5-5.6M17 14a5 5 0 0 1 4 5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  bell: <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  logout: <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 17l-5-5 5-5M5 12h10" />,
  check: <path d="m5 13 4 4 10-10" />,
  cross: <path d="M12 8v5M12 16.5v.5" />,
  "x-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  "help-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 .2c0 1.8-2.5 2.3-2.5 3.8M12 16.5v.5" />
    </>
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 2.6 17.4A1.9 1.9 0 0 0 4.3 20h15.4a1.9 1.9 0 0 0 1.7-2.6L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 16.5v.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.2 2.9 7.5 7 9.5 4.1-2 7-5.3 7-9.5V6z" />
      <path d="m9.5 12 2 2 3.5-4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
      <path d="M14 3v4h4M9 12h6M9 16h4" />
    </>
  ),
  refresh: <path d="M20 11a8 8 0 1 0-2.3 6M20 5v6h-6" />,
  edit: (
    <>
      <path d="M4 20h4L20 8l-4-4L4 16z" />
      <path d="m14.5 5.5 4 4" />
    </>
  ),
  play: <path d="M7 4.5 19 12 7 19.5z" />,
  star: <path d="m12 4 2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z" />,
  dot: <circle cx="12" cy="12" r="3.5" />,
  key: (
    <>
      <circle cx="8" cy="14" r="3.5" />
      <path d="m10.6 11.4 8-8M17 5l2 2M15 7l1.5 1.5" />
    </>
  ),
  download: <path d="M12 4v10M8 11l4 4 4-4M5 19h14" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 8 4.5-8 4.5-8-4.5z" />
      <path d="m4 12.5 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
    </>
  ),
  signal: (
    <>
      <path d="M4 18v-3.5M9 18V10M14 18V6.5M19 18v-8" />
      <path d="M3 21h18" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.dot}
    </svg>
  );
}
