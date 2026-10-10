import type { ProductDetail } from '@lastsize/contracts';
import { formatPrice } from '@lastsize/ui';

const W = 320;
const H = 90;
const PAD = 6;

/** Step chart of public sale prices over 90 days; the last point is today. */
export function PriceHistoryChart({
  points,
  label,
}: {
  points: ProductDetail['priceHistory'];
  label: string;
}) {
  if (points.length < 2) return null;
  const now = Date.now();
  const start = new Date(points[0]!.date).getTime();
  const prices = points.map((p) => p.salePrice);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const x = (time: number) => PAD + ((time - start) / Math.max(1, now - start)) * (W - PAD * 2);
  const y = (price: number) =>
    max === min ? H / 2 : PAD + ((max - price) / (max - min)) * (H - PAD * 2 - 14);
  let path = '';
  points.forEach((point, index) => {
    const px = x(new Date(point.date).getTime());
    const py = y(point.salePrice);
    path += index === 0 ? `M${px},${py}` : ` H${px} V${py}`;
  });
  path += ` H${x(now)}`;
  const last = points[points.length - 1]!;

  return (
    <figure className="grid gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-sm"
        role="img"
        aria-label={label}
      >
        <path d={path} fill="none" stroke="var(--ink)" strokeWidth="2" />
        <circle cx={x(now)} cy={y(last.salePrice)} r="3.5" fill="var(--sale)" />
        <text x={PAD} y={H - 2} fontSize="10" fill="var(--muted)">
          {new Date(points[0]!.date).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
          })}
        </text>
        <text x={W - PAD} y={H - 2} fontSize="10" fill="var(--muted)" textAnchor="end">
          {formatPrice(last.salePrice)}
        </text>
      </svg>
      <figcaption className="sr-only">
        {points
          .map(
            (p) => `${new Date(p.date).toLocaleDateString('ru-RU')}: ${formatPrice(p.salePrice)}`,
          )
          .join('; ')}
      </figcaption>
    </figure>
  );
}
