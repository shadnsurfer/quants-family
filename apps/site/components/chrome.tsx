/**
 * Acid-paper atoms: the petri mark, kickers, ruled section heads, serif formula
 * blocks, fact cells, P&L numerals, and the signature culture-well HP strip.
 * Server components — no client JS here.
 */
import { fmtPct } from "@/lib/world";

/** deterministic 0..1 hash — the genome's fingerprint as a number */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Agent profile picture. PLACEHOLDER until the backend profile-picture
 * generator ships (next step): when the world data carries an `avatarUrl`
 * for the quant, this renders the real image. Until then every quant gets a
 * deterministic genome identicon — a petri ring with three cells (ink, acid,
 * faint) placed and sized by a hash of its id. Same id, same face.
 */
export function Avatar({
  id,
  src,
  size = 30,
  className = "",
}: {
  id: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    // the real profile picture, once the generator backend writes avatarUrl
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`block shrink-0 rounded-full border border-rule object-cover ${className}`}
      />
    );
  }
  const a1 = hash01(id, 3) * Math.PI * 2;
  const a2 = hash01(id, 5) * Math.PI * 2;
  const a3 = hash01(id, 7) * Math.PI * 2;
  const d1 = 3.2 + hash01(id, 11) * 2.6;
  const d2 = 4.4 + hash01(id, 13) * 3.0;
  const d3 = 5.4 + hash01(id, 17) * 3.2;
  const r1 = 2.1 + hash01(id, 19) * 1.7;
  const r2 = 1.5 + hash01(id, 23) * 1.3;
  const r3 = 1.1 + hash01(id, 29) * 1.1;
  const px = (a: number, d: number) => 16 + Math.cos(a) * d;
  const py = (a: number, d: number) => 16 + Math.sin(a) * d;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={`block shrink-0 ${className}`}>
      <circle cx="16" cy="16" r="14" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.6" />
      <circle cx={px(a1, d1)} cy={py(a1, d1)} r={r1} fill="var(--ink)" />
      <circle cx={px(a2, d2)} cy={py(a2, d2)} r={r2} fill="var(--accent)" stroke="var(--ink)" strokeWidth="0.7" />
      <circle cx={px(a3, d3)} cy={py(a3, d3)} r={r3} fill="var(--faint)" />
    </svg>
  );
}

export function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`kicker ${className}`}>{children}</div>;
}

/** ruled section head: kicker left, specimen note right, hairline below */
export function SectionHead({
  kicker,
  note,
  className = "",
}: {
  kicker: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-rule pb-2.5 ${className}`}>
      <Kicker>{kicker}</Kicker>
      {note ? <span className="specimen text-[14px] leading-snug text-right">{note}</span> : null}
    </div>
  );
}

/**
 * Full-width page head: kicker, headline, specimen note — with an optional
 * right rail for stat chips and figure tags. The console's title strip.
 */
export function PageHead({
  kicker,
  title,
  note,
  aside,
}: {
  kicker: string;
  title: React.ReactNode;
  note?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-rule px-5 py-7 sm:px-8">
      <div className="min-w-0">
        <Kicker>{kicker}</Kicker>
        <h1 className="mt-3 text-[26px] font-normal leading-[1.18] tracking-[-0.01em] text-ink sm:text-[32px]">
          {title}
        </h1>
        {note ? <p className="specimen mt-2.5 max-w-[600px] text-[15.5px] leading-relaxed">{note}</p> : null}
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1">{aside}</div> : null}
    </div>
  );
}

/** the elevator formula block: stix italic, centered, ruled top and bottom */
export function Formula({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="border-y border-rule">
      <div className="flex flex-col items-center gap-1 px-6 py-7 text-center font-serif text-[19px] italic leading-relaxed text-ink">
        {children}
      </div>
      {note ? (
        <p className="border-t border-softrule px-6 py-3 text-center text-[12.5px] leading-relaxed text-dim">{note}</p>
      ) : null}
    </div>
  );
}

/** one cell of the ruled fact grid: tiny tracked label over a medium value */
export function Fact({
  label,
  value,
  accent = false,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={`min-w-0 px-4 py-4 sm:px-5 ${className}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-dim">{label}</div>
      <div className={`mt-1.5 truncate text-[16px] font-medium ${accent ? "" : "text-ink"}`}>
        {accent ? <span className="hl">{value}</span> : value}
      </div>
    </div>
  );
}

export function Pnl({ value, className = "" }: { value: number; className?: string }) {
  const cls = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-dim";
  return <span className={`${cls} ${className}`}>{fmtPct(value)}</span>;
}

/**
 * The signature element: a 10-well culture strip on paper. Wells drain as a
 * quant approaches the ruin line; the last wells burn red. A dead quant reads flat.
 */
export function HpWell({ hp, dead, compact = false }: { hp: number; dead?: boolean; compact?: boolean }) {
  const filled = dead ? 0 : Math.round(hp * 10);
  const tone = filled > 3 ? "bg-[var(--well-on)]" : "bg-down";
  return (
    <span
      className="inline-flex items-center gap-[2px]"
      title={dead ? "flatline" : `hp ${(hp * 100).toFixed(0)}% — distance to the ruin line`}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={`${compact ? "h-[10px] w-[5px]" : "h-[13px] w-[7px]"} rounded-[1px] ${
            i < filled ? tone : "bg-[var(--well-off)]"
          }`}
        />
      ))}
      {dead ? <span className="ml-2 text-[12px] uppercase tracking-[0.14em] text-faint">flatline</span> : null}
    </span>
  );
}

/** tiny bordered chip — archetypes, voices, statuses */
export function Chip({
  children,
  tone = "dim",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "dim" | "up" | "down" | "amber" | "accent" | "ink";
  className?: string;
}) {
  const tones: Record<string, string> = {
    dim: "border-softrule text-dim",
    up: "border-up/50 text-up",
    down: "border-down/50 text-down",
    amber: "border-amber/60 text-amber",
    accent: "border-rule bg-accent text-ink",
    ink: "border-rule text-ink",
  };
  return (
    <span className={`inline-flex items-center border px-1.5 py-px text-[11px] font-medium uppercase tracking-[0.12em] ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** elevator-style text link: hairline underline that turns acid on hover */
export function TextLink({
  href,
  children,
  external = false,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="inline-flex items-center gap-1.5 border-b border-ink pb-0.5 text-[12px] font-medium uppercase tracking-[0.14em] text-ink transition-colors hover:border-transparent hover:bg-accent"
    >
      {children} <span aria-hidden>→</span>
    </a>
  );
}
