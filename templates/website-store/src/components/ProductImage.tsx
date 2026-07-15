import Image from "next/image";

type Props = {
  src?: string | null;
  alt: string;
  productName: string;
  className?: string;
  sizes?: string;
};

// Deterministic gradient from a string — so each product placeholder is
// stable across renders and visually distinct. Looks intentional rather
// than broken while real photos are still being shot.
function hueFromString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash) % 360;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProductImage({
  src,
  alt,
  productName,
  className = "",
  sizes,
}: Props) {
  if (src) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes ?? "(max-width: 768px) 100vw, 33vw"}
        className={`object-cover ${className}`}
      />
    );
  }

  const hue = hueFromString(productName);
  const bg = `linear-gradient(135deg, hsl(${hue}, 60%, 88%) 0%, hsl(${(hue + 40) % 360}, 55%, 72%) 100%)`;

  return (
    <div
      className={`flex items-center justify-center text-foreground/40 font-bold tracking-tighter ${className}`}
      style={{ background: bg }}
      aria-label={alt}
    >
      <span className="text-4xl sm:text-5xl">{initials(productName)}</span>
    </div>
  );
}
