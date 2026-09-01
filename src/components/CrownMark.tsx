interface CrownMarkProps {
  size?: number
  className?: string
}

export function CrownMark({ size = 28, className }: CrownMarkProps): React.JSX.Element {
  return (
    <img
      className={className}
      src="/redgrab-brand.png"
      alt="RedGrab"
      width={size}
      height={size}
      decoding="async"
      draggable={false}
    />
  )
}
