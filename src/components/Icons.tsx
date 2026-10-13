// 線條圖示(取代表情符號)。裝飾用的圖示一律 aria-hidden,由旁邊的按鈕文字或 aria-label 說明用途。

interface IconProps {
  size?: number
}

function Svg({ size = 20, strokeWidth = 2, children }: IconProps & { strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const PaperclipIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Svg>
)

export const CloseIcon = ({ size }: IconProps) => (
  <Svg size={size} strokeWidth={2.2}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
)

export const ChevronDownIcon = ({ size }: IconProps) => (
  <Svg size={size} strokeWidth={2.4}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
)

export const ArrowDownIcon = ({ size }: IconProps) => (
  <Svg size={size} strokeWidth={2.4}>
    <path d="M12 5v14M5 12l7 7 7-7" />
  </Svg>
)

export const FileIcon = ({ size }: IconProps) => (
  <Svg size={size} strokeWidth={1.8}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </Svg>
)
