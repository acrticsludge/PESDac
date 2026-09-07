"use client";

// Designer-only brand-directions gallery. The component was removed
// during the auth-integration commit (c4ab411) but the route remained.
// Stub it so `astro build` resolves the import; the route still
// renders a placeholder card. Reimplement the real gallery by adding
// the original `MockupGallery` under this path.
export default function MockupGallery() {
  return null;
}
