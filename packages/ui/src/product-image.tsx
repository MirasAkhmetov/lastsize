import { cn } from './cn';

export interface ProductImageProps {
  /** Folder URL from the API, e.g. "/media/products/<store>/<id>/". */
  url: string;
  alt: string;
  /** How wide the image is shown, for the browser to pick a file. */
  sizes?: string;
  className?: string;
  priority?: boolean;
}

const WIDTHS = [320, 640, 1080];
const srcSet = (url: string, format: 'avif' | 'webp') =>
  WIDTHS.map((width) => `${url}${width}.${format} ${width}w`).join(', ');

/** Responsive product photo: AVIF where supported, WebP otherwise, the right width for the screen. */
export function ProductImage({
  url,
  alt,
  sizes = '(min-width: 768px) 25vw, 50vw',
  className,
  priority = false,
}: ProductImageProps) {
  return (
    <picture>
      <source type="image/avif" srcSet={srcSet(url, 'avif')} sizes={sizes} />
      <source type="image/webp" srcSet={srcSet(url, 'webp')} sizes={sizes} />
      <img
        src={`${url}640.webp`}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className={cn('size-full object-cover', className)}
      />
    </picture>
  );
}
