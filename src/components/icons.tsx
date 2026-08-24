import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function IconFrame({ children, size = 22, ...props }: IconProps & { children: ReactNode }): React.JSX.Element {
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
      {...props}
    >
      {children}
    </svg>
  )
}

export function BrandMark({ size = 32, ...props }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <path d="M9.5 8.5L17.1 21.2L9.5 39.5H16.5L24 26.7L31.5 39.5H38.5L30.9 21.2L38.5 8.5H31.5L24 16.9L16.5 8.5H9.5Z" fill="currentColor" />
      <circle cx="38.1" cy="9.7" r="3.3" fill="#FFC46B" />
    </svg>
  )
}

export function HomeIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z" /></IconFrame>
}

export function CompassIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><circle cx="12" cy="12" r="8.5" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" /></IconFrame>
}

export function LibraryIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.2" /><path d="m4 17 4.6-4.6a1.5 1.5 0 0 1 2.1 0L13 14.7l1.6-1.6a1.5 1.5 0 0 1 2.1 0L20 16.4" /></IconFrame>
}

export function DownloadIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M12 3v11" /><path d="m8 10 4 4 4-4" /><path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></IconFrame>
}

export function UploadIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></IconFrame>
}

export function UserIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><circle cx="12" cy="8" r="3.5" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></IconFrame>
}

export function SearchIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></IconFrame>
}

export function BookmarkIcon({ filled = false, ...props }: IconProps & { filled?: boolean }): React.JSX.Element {
  return <IconFrame {...props} fill={filled ? 'currentColor' : 'none'}><path d="M6 3.8A1.8 1.8 0 0 1 7.8 2h8.4A1.8 1.8 0 0 1 18 3.8V22l-6-3.7L6 22V3.8Z" /></IconFrame>
}

export function PlayIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props} fill="currentColor" strokeWidth="1.4"><path d="m9 7 8 5-8 5V7Z" /></IconFrame>
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="m6 6 12 12M18 6 6 18" /></IconFrame>
}

export function RefreshIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M20 11a8 8 0 1 0 1.2 4.2" /><path d="M20 4v7h-7" /></IconFrame>
}

export function ChevronRightIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="m9 18 6-6-6-6" /></IconFrame>
}

export function ArrowLeftIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="m15 18-6-6 6-6" /></IconFrame>
}

export function LinkIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M10 13.8a4.4 4.4 0 0 0 6.2.1l2.2-2.2a4.4 4.4 0 0 0-6.2-6.2L11 6.7" /><path d="M14 10.2a4.4 4.4 0 0 0-6.2-.1l-2.2 2.2a4.4 4.4 0 0 0 6.2 6.2l1.2-1.2" /></IconFrame>
}

export function CheckIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="m5 12 4.2 4.2L19 6.5" /></IconFrame>
}

export function TrashIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M4 7h16M9 7V4h6v3M7 7l.8 13h8.4L17 7M10 11v5M14 11v5" /></IconFrame>
}

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.2 2.2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.2v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L6.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5v-3.2h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.2-2.2.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3.2v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.2 2.2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1V14H20a1.7 1.7 0 0 0-1.6 1Z" /></IconFrame>
}

export function LogOutIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" /><path d="m14 16 4-4-4-4M18 12H9" /></IconFrame>
}

export function ExternalIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></IconFrame>
}

export function SparkIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></IconFrame>
}

export function HeartIcon({ filled = false, ...props }: IconProps & { filled?: boolean }): React.JSX.Element {
  return <IconFrame {...props} fill={filled ? 'currentColor' : 'none'}><path d="M20.8 8.4c0 5.3-8.8 10.6-8.8 10.6S3.2 13.7 3.2 8.4A4.4 4.4 0 0 1 11 5.6L12 6.8l1-1.2a4.4 4.4 0 0 1 7.8 2.8Z" /></IconFrame>
}

export function ShareIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" /></IconFrame>
}

export function VolumeIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M4 10v4h4l5 4V6L8 10H4Z" /><path d="M16 9.2a4 4 0 0 1 0 5.6M18.5 6.7a7.5 7.5 0 0 1 0 10.6" /></IconFrame>
}

export function MuteIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props}><path d="M4 10v4h4l5 4V6L8 10H4Z" /><path d="m17 10 4 4m0-4-4 4" /></IconFrame>
}

export function PauseIcon(props: IconProps): React.JSX.Element {
  return <IconFrame {...props} fill="currentColor"><path d="M8 6h3v12H8zM13 6h3v12h-3z" stroke="none" /></IconFrame>
}

export function StudioIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <rect x="3" y="4" width="18" height="14" rx="2.4" />
      <path d="m9.5 8.4 5 2.6-5 2.6V8.4Z" fill="currentColor" stroke="none" />
    </IconFrame>
  )
}
