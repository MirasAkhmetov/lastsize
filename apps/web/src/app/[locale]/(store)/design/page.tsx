import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DesignShowcase } from './showcase';

export const metadata: Metadata = { title: 'Design system', robots: { index: false } };

/** Living reference of the UI kit. Available in development only. */
export default function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DesignShowcase />;
}
