import type { SVGProps } from "react";

export type AuthBackgroundVariant = "grid" | "contours" | "nodes";

type Props = SVGProps<SVGSVGElement> & { variant?: AuthBackgroundVariant };

/** Monochrome decorative background for the non-form side of auth cards. */
export function AuthBackground({ variant = "grid", ...props }: Props) {
  const id = `auth-background-${variant}`;
  return (
    <svg className={`auth-background auth-background-${variant}`} viewBox="0 0 640 820" preserveAspectRatio="xMidYMid slice" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#262626" stopOpacity=".65" /><stop offset="1" stopColor="#1b1b1b" stopOpacity=".95" /></linearGradient>
        <pattern id={`${id}-grid`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fafafa" strokeOpacity=".055" /><circle cx="0" cy="0" r="1" fill="#fafafa" fillOpacity=".12" /></pattern>
        <pattern id={`${id}-micro`} width="18" height="18" patternUnits="userSpaceOnUse"><path d="M0 9h18M9 0v18" stroke="#fafafa" strokeOpacity=".04" strokeWidth=".6" /></pattern>
        <filter id={`${id}-blur`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12" /></filter>
      </defs>
      <rect width="640" height="820" fill={`url(#${id}-fade)`} />
      {variant === "grid" && <><rect width="640" height="820" fill={`url(#${id}-grid)`} /><g fill="none" stroke="#fafafa" strokeOpacity=".1"><circle cx="480" cy="160" r="190" /><circle cx="480" cy="160" r="145" /><circle cx="480" cy="160" r="95" /><path d="M290 160h380M480-30v380M346 26l268 268M346 294 614 26" /></g><circle cx="480" cy="160" r="4" fill="#a3a3a3" /><path d="M0 650 640 300" stroke="#fafafa" strokeOpacity=".09" /></>}
      {variant === "contours" && <><rect width="640" height="820" fill={`url(#${id}-micro)`} /><g fill="none" stroke="#fafafa" strokeOpacity=".11"><path d="M-80 570C70 390 155 725 300 520S545 300 720 450" /><path d="M-90 625C60 445 160 775 305 575S555 350 730 505" /><path d="M-100 680C50 500 165 825 310 630S565 400 740 560" /><path d="M-110 735C40 555 170 875 315 685S575 450 750 615" /><path d="M-50 115C110 240 220 35 350 160S550 330 700 205" /></g><circle cx="416" cy="550" r="118" fill="#fafafa" fillOpacity=".025" filter={`url(#${id}-blur)`} /></>}
      {variant === "nodes" && <><rect width="640" height="820" fill={`url(#${id}-grid)`} opacity=".65" /><g fill="none" stroke="#a3a3a3" strokeOpacity=".16"><path d="M55 95 220 180l125-90 160 145 92-82" /><path d="m220 180 75 170 175-15 60 158-180 100-155-88" /><path d="m345 90-50 260 175-15" /><path d="m335 535-48 180 203 35" /></g><g fill="#a3a3a3"><circle cx="55" cy="95" r="3" /><circle cx="220" cy="180" r="5" /><circle cx="345" cy="90" r="3" /><circle cx="505" cy="235" r="4" /><circle cx="597" cy="153" r="3" /><circle cx="295" cy="350" r="5" /><circle cx="470" cy="335" r="3" /><circle cx="530" cy="493" r="5" /><circle cx="335" cy="535" r="3" /><circle cx="287" cy="715" r="4" /><circle cx="490" cy="750" r="3" /></g></>}
      <rect x="1" y="1" width="638" height="818" fill="none" stroke="#fafafa" strokeOpacity=".08" />
    </svg>
  );
}
