// OpenRouter brand tile (official PNG in `frontend/public/`).
// Decorative — the adjacent provider name carries the label.

export default function OpenRouterLogo({ size = 30 }: { size?: number }) {
  return (
    <img
      src="/openrouter-logo.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{ flexShrink: 0, borderRadius: size * 0.24 }}
    />
  );
}
