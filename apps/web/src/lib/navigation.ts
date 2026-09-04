export type PrimaryNavigationId = 'today' | 'year-plan' | 'courses' | 'sharing' | 'school';

export type PrimaryNavigationItem = {
  id: PrimaryNavigationId;
  label: string;
  href: string;
};

export const primaryNavigationItems: PrimaryNavigationItem[] = [
  { id: 'today', label: 'Today', href: '/today' },
  { id: 'year-plan', label: 'Year Plan', href: '/year-plan' },
  { id: 'courses', label: 'Courses', href: '/courses' },
  { id: 'sharing', label: 'Sharing', href: '/sharing' },
  { id: 'school', label: 'School', href: '/school' }
];

export function primaryNavigationIdForPath(pathname: string): PrimaryNavigationId | null {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (
    normalizedPathname === '/today' ||
    normalizedPathname === '/dashboard' ||
    normalizedPathname.startsWith('/classroom')
  ) {
    return 'today';
  }
  if (normalizedPathname === '/year-plan') return 'year-plan';
  if (normalizedPathname === '/courses' || normalizedPathname.startsWith('/courses/')) {
    return 'courses';
  }
  if (normalizedPathname === '/sharing') return 'sharing';
  if (normalizedPathname === '/school') return 'school';
  return null;
}
