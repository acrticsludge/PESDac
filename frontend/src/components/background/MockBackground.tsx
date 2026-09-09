"use client";

import { useState, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Sparse Node Garden — Book of Shapes inspiration                 */
/*  Nodes twinkle; visible links; not crowded.                      */
/* ------------------------------------------------------------------ */

export default function MockBackground() {
  const [hovered, setHovered] = useState(false);

  // Sparse nodes — only 14, spread out
  const nodes = [
    { x: 18, y: 22 },
    { x: 42, y: 15 },
    { x: 78, y: 28 },
    { x: 12, y: 58 },
    { x: 56, y: 62 },
    { x: 88, y: 52 },
    { x: 28, y: 82 },
    { x: 72, y: 78 },
    { x: 48, y: 38 },
    { x: 22, y: 42 },
    { x: 82, y: 18 },
    { x: 36, y: 72 },
    { x: 92, y: 68 },
    { x: 62, y: 12 },
  ];

  // Build sparse connections (nearest neighbor within radius ~25)
  const radius = 26;
  const links: [number, number][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < radius) links.push([i, j]);
    }
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        pointerEvents: "none",
        background: "linear-gradient(160deg, #171717 0%, #1b1b1b 55%, #141414 100%)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          {/* Visible line style */}
          <filter id="ng-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="0.6" floodColor="#fafafa" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* Lines — thick enough to see, not too many */}
        <g filter={hovered ? "url(#ng-glow)" : "none"} stroke="#fafafa" strokeWidth="0.9" strokeOpacity={hovered ? 0.55 : 0.35} fill="none" strokeLinecap="round">
          {links.map(([a, b], idx) => (
            <line
              key={idx}
              x1={`${nodes[a].x}`}
              y1={`${nodes[a].y}`}
              x2={`${nodes[b].x}`}
              y2={`${nodes[b].y}`}
            />
          ))}
        </g>

        {/* Nodes — twinkling dots */}
        {nodes.map((n, i) => (
          <g key={i}>
            {/* Soft glow halo */}
            <circle
              cx={`${n.x}`}
              cy={`${n.y}`}
              r="2.2"
              fill="#fafafa"
              fillOpacity={hovered ? 0.22 : 0.08}
            />
            {/* Bright core */}
            <circle
              cx={`${n.x}`}
              cy={`${n.y}`}
              r="1.2"
              fill="#fafafa"
              fillOpacity={hovered ? 0.95 : 0.75}
            >
              <animate
                attributeName="fill-opacity"
                values={`${hovered ? 0.95 : 0.75};${hovered ? 0.5 : 0.35};${hovered ? 0.95 : 0.75}`}
                dur={`${2 + i * 0.4}s`}
                repeatCount="indefinite"
              />
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}
