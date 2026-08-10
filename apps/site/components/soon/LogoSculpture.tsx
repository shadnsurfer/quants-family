/**
 * The mark sculpture — the plain field's one complex object. The ink mark
 * breathes over an acid underlay that shifts with the pointer; a dashed
 * hairline ring spins one way, the orbit text counter-rotates the other, and
 * acid satellites circle. Pointer response comes from --mx/--my (set by
 * MouseTracker) straight in CSS — this stays a server component.
 */
export function LogoSculpture({ size = 230, className = "" }: { size?: number; className?: string }) {
  return (
    <div className={`sculpt-stage ${className}`} style={{ width: size, height: size }} aria-hidden>
      <div className="sculpt-tilt">
        <div className="sculpt-acid" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mark-black.png" alt="" className="sculpt-mark" />
        <svg className="sculpt-ring" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="48.5" stroke="var(--faint)" strokeWidth="0.4" strokeDasharray="1.2 3.2" opacity="0.7" />
          <circle cx="50" cy="50" r="44" stroke="var(--softrule)" strokeWidth="0.3" opacity="0.9" />
        </svg>
        <svg className="sculpt-orbit" viewBox="0 0 100 100" fill="none">
          <defs>
            <path id="sculpt-orbit-path" d="M50,50 m-40,0 a40,40 0 1,1 80,0 a40,40 0 1,1 -80,0" />
          </defs>
          <text
            fill="var(--dim)"
            style={{ fontFamily: "var(--font-mono), monospace", fontSize: "5.6px", letterSpacing: "1.32px", textTransform: "uppercase" }}
          >
            <textPath href="#sculpt-orbit-path" textLength="250">
              quants.family · bred, not hired · season zero ·
            </textPath>
          </text>
        </svg>
        <span className="sculpt-sat" style={{ inset: "7%" }}><i /></span>
        <span className="sculpt-sat sat-b" style={{ inset: "1%" }}><i /></span>
        <span className="sculpt-sat sat-c" style={{ inset: "-7%" }}><i /></span>
      </div>
    </div>
  );
}
