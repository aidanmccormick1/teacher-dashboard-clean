export type PrimaryNavigationId = 'today' | 'year-plan' | 'courses' | 'school';

export type PrimaryNavigationItem = {
  id: PrimaryNavigationId;
  label: string;
  href: string;
  icon: string;
};

export const primaryNavigationItems: PrimaryNavigationItem[] = [
  { id: 'today', label: 'Today', href: '/today', icon: '◷' },
  { id: 'year-plan', label: 'Year Plan', href: '/year-plan', icon: '▤' },
  { id: 'courses', label: 'Courses', href: '/courses', icon: '▦' },
  { id: 'school', label: 'School', href: '/school', icon: '⌂' }
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
  if (normalizedPathname === '/school') return 'school';
  return null;
}
