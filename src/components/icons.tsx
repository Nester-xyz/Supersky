import type { ReactNode, SVGProps } from 'react';

/**
 * Supersky's hand-drawn icon set: 24px grid, 1.8 stroke, rounded caps.
 * Kept in-house (no icon library) so the visual language stays ours.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function createIcon(name: string, children: ReactNode, filled = false) {
  function Icon({ size = 18, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={filled ? 0 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const SendIcon = createIcon(
  'SendIcon',
  <>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </>,
);

export const ImageIcon = createIcon(
  'ImageIcon',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </>,
);

export const SmileIcon = createIcon(
  'SmileIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    <path d="M9 9h.01" />
    <path d="M15 9h.01" />
  </>,
);

export const GlobeIcon = createIcon(
  'GlobeIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <ellipse cx="12" cy="12" rx="4" ry="9" />
  </>,
);

export const XIcon = createIcon(
  'XIcon',
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);

export const SlidersIcon = createIcon(
  'SlidersIcon',
  <>
    <path d="M4 7h8" />
    <circle cx="16.5" cy="7" r="2.5" />
    <path d="M20 17h-8" />
    <circle cx="7.5" cy="17" r="2.5" />
  </>,
);

export const SunIcon = createIcon(
  'SunIcon',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.9 4.9 1.4 1.4" />
    <path d="m17.7 17.7 1.4 1.4" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.3 17.7-1.4 1.4" />
    <path d="m19.1 4.9-1.4 1.4" />
  </>,
);

export const MoonIcon = createIcon(
  'MoonIcon',
  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
);

export const MonitorIcon = createIcon(
  'MonitorIcon',
  <>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  </>,
);

export const LogOutIcon = createIcon(
  'LogOutIcon',
  <>
    <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </>,
);

export const ExternalLinkIcon = createIcon(
  'ExternalLinkIcon',
  <>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>,
);

export const ChevronDownIcon = createIcon('ChevronDownIcon', <path d="m6 9 6 6 6-6" />);

export const ArrowRightIcon = createIcon(
  'ArrowRightIcon',
  <>
    <path d="M5 12h14" />
    <path d="m13 5 7 7-7 7" />
  </>,
);

export const ChevronRightIcon = createIcon('ChevronRightIcon', <path d="m9 18 6-6-6-6" />);

export const AtSignIcon = createIcon(
  'AtSignIcon',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </>,
);

export const LockIcon = createIcon(
  'LockIcon',
  <>
    <rect x="3" y="11" width="18" height="11" rx="2.5" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);

export const PlusIcon = createIcon(
  'PlusIcon',
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const CheckIcon = createIcon('CheckIcon', <path d="M20 6 9 17l-5-5" />);

export const AlertCircleIcon = createIcon(
  'AlertCircleIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </>,
);

export const InfoIcon = createIcon(
  'InfoIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </>,
);

export const EyeIcon = createIcon(
  'EyeIcon',
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const EyeOffIcon = createIcon(
  'EyeOffIcon',
  <>
    <path d="m3 3 18 18" />
    <path d="M10.6 5.8A9.9 9.9 0 0 1 12 5.7c6 0 9.5 6.3 9.5 6.3a17.6 17.6 0 0 1-2.3 3.1" />
    <path d="M6.6 6.6C4 8.4 2.5 12 2.5 12S6 18.3 12 18.3c1.4 0 2.8-.35 4-1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </>,
);

export const LinkIcon = createIcon(
  'LinkIcon',
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>,
);

export const UserIcon = createIcon(
  'UserIcon',
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
  </>,
);

export const UserRoundPlusIcon = createIcon(
  'UserRoundPlusIcon',
  <>
    <path d="M2 21a8 8 0 0 1 13.292-6" />
    <circle cx="10" cy="8" r="5" />
    <path d="M19 16v6" />
    <path d="M22 19h-6" />
  </>,
);

export const SparkleIcon = createIcon(
  'SparkleIcon',
  <path d="M12 2.5c.8 5 3.9 8.1 9 9-5.1.9-8.2 4-9 9-.8-5-3.9-8.1-9-9 5.1-.9 8.2-4 9-9Z" />,
  true,
);

export const ContrastIcon = createIcon(
  'ContrastIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18Z" />
  </>,
);

export const BellIcon = createIcon(
  'BellIcon',
  <>
    <path d="M18 8a6 6 0 0 0-12 0c0 4.2-1.3 5.6-2.6 7a1 1 0 0 0 .74 1.7h15.72a1 1 0 0 0 .74-1.7C19.3 13.6 18 12.2 18 8Z" />
    <path d="M10.3 20.6a2 2 0 0 0 3.4 0" />
  </>,
);

export const GifIcon = createIcon(
  'GifIcon',
  <>
    <rect x="2.5" y="5" width="19" height="14" rx="3" />
    <path d="M9.5 10h-1.75a1.75 1.75 0 0 0-1.75 1.75v.5A1.75 1.75 0 0 0 7.75 14H9.5v-2.25H8.4" />
    <path d="M12 10v4" />
    <path d="M14.75 14v-4h3.25" />
    <path d="M14.75 12.15h2.5" />
  </>,
);

export const VideoIcon = createIcon(
  'VideoIcon',
  <>
    <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
    <path d="m15.5 10.8 5-3.3v9l-5-3.3" />
  </>,
);

export const TrashIcon = createIcon(
  'TrashIcon',
  <>
    <path d="M3.5 6h17" />
    <path d="M8.5 6V4.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V6" />
    <path d="M18.5 6v13a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 19V6" />
    <path d="M10 10.5v6" />
    <path d="M14 10.5v6" />
  </>,
);

export const DraftsIcon = createIcon(
  'DraftsIcon',
  <>
    <path d="M14.5 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7.5Z" />
    <path d="M14.5 2.5v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h4" />
  </>,
);

export const UsersIcon = createIcon(
  'UsersIcon',
  <>
    <path d="M15.5 21v-2a4 4 0 0 0-4-4h-5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7.5" r="3.75" />
    <path d="M21.5 21v-2a4 4 0 0 0-3-3.85" />
    <path d="M15.5 3.9a3.75 3.75 0 0 1 0 7.2" />
  </>,
);

export const ReplyBubbleIcon = createIcon(
  'ReplyBubbleIcon',
  <path d="M21 11.5a8.38 8.38 0 0 1-8.4 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.4-8.4h.5a8.48 8.48 0 0 1 8.1 8.1Z" />,
);

export const QuoteIcon = createIcon(
  'QuoteIcon',
  <>
    <path d="M9.5 5.5a5 5 0 0 0-5 5v7a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H7a3.5 3.5 0 0 1 2.5-3.35Z" />
    <path d="M20 5.5a5 5 0 0 0-5 5v7a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-2.5A3.5 3.5 0 0 1 20 9.15Z" />
  </>,
);

export const SearchIcon = createIcon(
  'SearchIcon',
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20.5 20.5-4.5-4.5" />
  </>,
);
