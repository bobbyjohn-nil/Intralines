// Compact stroke-style SVG icons (no emoji). All inherit currentColor.

interface IconProps {
  size?: number;
}

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconPointer = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3l14 7-6.5 1.7L9 18z" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconDepot = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10l9-6 9 6v10h-4v-7H7v7H3z" />
    <path d="M7 20v-3h10v3" />
  </Svg>
);

export const IconHeat = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" opacity="0.45" />
    <rect x="4" y="13" width="7" height="7" rx="1" opacity="0.45" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </Svg>
);

export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5s1.3-6.1 3.9-8.5z" />
  </Svg>
);

export const IconMapFold = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z" />
    <path d="M9 4v13M15 6.5v13" />
  </Svg>
);

export const IconRoute = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8 16.5c3-1.5 5.5-4 8-8.5" />
  </Svg>
);

export const IconBus = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="12" rx="2" />
    <path d="M4 12h16M8 5v7M16 5v7" opacity="0.6" />
    <circle cx="8" cy="18.5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="16" cy="18.5" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPeople = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19c.7-3.2 2.8-5 5.5-5s4.8 1.8 5.5 5" />
    <circle cx="16.5" cy="9" r="2.4" opacity="0.55" />
    <path d="M15.5 14.2c2.3.2 4.1 1.8 4.8 4.4" opacity="0.55" />
  </Svg>
);

export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M7 15l4-4 3 2.5L19 8" />
  </Svg>
);

export const IconHelp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.5 9.4c.3-1.4 1.3-2.2 2.7-2.2 1.5 0 2.6 1 2.6 2.3 0 1.9-2.5 2.1-2.5 4" />
    <circle cx="12.2" cy="16.8" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5v14M15 5v14" strokeWidth="2.4" />
  </Svg>
);

export const IconPlay = ({ size = 20, count = 1 }: IconProps & { count?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    aria-hidden="true"
  >
    {count === 1 && <path d="M8 5l10 7-10 7z" />}
    {count === 2 && (
      <>
        <path d="M4.5 6l8 6-8 6z" />
        <path d="M13 6l8 6-8 6z" />
      </>
    )}
    {count === 3 && (
      <>
        <path d="M2.5 7l6.5 5-6.5 5z" />
        <path d="M9.5 7l6.5 5-6.5 5z" />
        <path d="M16.5 7l6.5 5-6.5 5z" />
      </>
    )}
  </svg>
);

export const IconCash = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="11" rx="2" />
    <circle cx="12" cy="12.5" r="2.6" />
  </Svg>
);

export const IconRider = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="6.5" r="2.8" />
    <path d="M6 20c.8-4 3-6.2 6-6.2s5.2 2.2 6 6.2" />
  </Svg>
);

export const IconSmile = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14c1 1.4 2.2 2.1 3.5 2.1s2.5-.7 3.5-2.1" />
    <circle cx="9" cy="9.7" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="15" cy="9.7" r="0.7" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconSignal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19v-4M10 19V11M15 19V7M20 19V4" strokeWidth="2.2" />
  </Svg>
);

export const IconCar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 13l1.5-4.5A2 2 0 018.4 7h7.2a2 2 0 011.9 1.5L19 13v5h-2.5v-1.5h-9V18H5z" />
    <circle cx="8.3" cy="14.8" r="0.8" fill="currentColor" stroke="none" />
    <circle cx="15.7" cy="14.8" r="0.8" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="11" width="12" height="9" rx="1.6" />
    <path d="M8.5 11V8a3.5 3.5 0 017 0v3" />
  </Svg>
);

export const IconWrench = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6.5a4 4 0 015.4-4.2L17 5.2l1.8 1.8 2.9-2.9a4 4 0 01-5.5 5.4L8 17.7A2 2 0 114.9 15L12.7 7c-.1 0 1.8-.5 1.8-.5z" />
  </Svg>
);

export const IconIdBadge = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="4" width="14" height="16" rx="2" />
    <circle cx="12" cy="10" r="2.2" />
    <path d="M8.5 16.5c.6-1.7 1.9-2.6 3.5-2.6s2.9.9 3.5 2.6" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v10m0 0l-4-4m4 4l4-4" />
    <path d="M5 19h14" />
  </Svg>
);

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 14V4m0 0L8 8m4-4l4 4" />
    <path d="M5 19h14" />
  </Svg>
);

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6L4 10l4 4" />
    <path d="M4 10h9a6 6 0 016 6v1" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l5 5L19 7" />
  </Svg>
);

export const IconBank = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 9l9-5 9 5v1H3z" />
    <path d="M5.5 10v7M10 10v7M14 10v7M18.5 10v7M3.5 19.5h17" />
  </Svg>
);

/** side-view bus silhouette whose length varies by model */
export const BusSide = ({ length = 1, size = 40 }: { length?: number; size?: number }) => {
  const w = 20 + length * 14;
  return (
    <svg
      width={(size * (w + 8)) / 42}
      height={size * 0.55}
      viewBox={`0 0 ${w + 8} 26`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width={w} height="14" rx="3" />
      <path d={`M7 10h${w - 8}`} opacity="0.5" />
      <circle cx="10" cy="20.5" r="2.6" fill="currentColor" stroke="none" />
      <circle cx={w - 4} cy="20.5" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
};
