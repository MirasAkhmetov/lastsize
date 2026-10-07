import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Locale-aware Link, redirect and router: /seller/login becomes /kk/seller/login for Kazakh. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
