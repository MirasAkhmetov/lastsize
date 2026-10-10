'use client';

import type { Media } from '@lastsize/contracts';
import { cn, ProductImage } from '@lastsize/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

/** Swipeable photos on phones (scroll snap), thumbnails on larger screens. */
export function ProductGallery({
  images,
  alt,
  badge,
}: {
  images: Media[];
  alt: string;
  badge?: React.ReactNode;
}) {
  const t = useTranslations('product');
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  const show = (index: number) => {
    const slide = track.current?.children[index] as HTMLElement | undefined;
    slide?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  };

  if (images.length === 0) return <div className="aspect-[3/4] rounded-img bg-photo-1" />;

  return (
    <div className="grid gap-2 md:grid-cols-[64px_1fr] md:gap-3">
      <div className="relative order-1 md:order-2">
        <div
          ref={track}
          onScroll={(event) => {
            const element = event.currentTarget;
            setCurrent(Math.round(element.scrollLeft / element.clientWidth));
          }}
          className="flex snap-x snap-mandatory overflow-x-auto rounded-img [scrollbar-width:none]"
        >
          {images.map((image, index) => (
            <div
              key={image.id}
              className="aspect-[3/4] w-full shrink-0 snap-start bg-photo-1"
              aria-label={t('photo', { n: index + 1, total: images.length })}
            >
              <ProductImage
                url={image.url}
                alt={index === 0 ? alt : `${alt} — ${index + 1}`}
                sizes="(min-width: 768px) 50vw, 100vw"
                priority={index === 0}
              />
            </div>
          ))}
        </div>
        {badge && <div className="absolute top-3 left-3">{badge}</div>}
        {images.length > 1 && (
          <div
            className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5 md:hidden"
            aria-hidden
          >
            {images.map((image, index) => (
              <span
                key={image.id}
                className={cn('size-1.5 rounded-full', index === current ? 'bg-ink' : 'bg-ink/30')}
              />
            ))}
          </div>
        )}
      </div>
      {images.length > 1 && (
        <ul className="order-2 hidden content-start gap-2 md:order-1 md:grid">
          {images.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => show(index)}
                aria-label={t('photo', { n: index + 1, total: images.length })}
                aria-current={index === current}
                className={cn(
                  'block aspect-[3/4] w-full overflow-hidden rounded-img border-2',
                  index === current ? 'border-ink' : 'border-transparent',
                )}
              >
                <ProductImage url={image.url} alt="" sizes="64px" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
