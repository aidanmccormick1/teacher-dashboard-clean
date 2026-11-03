export function loginReturnPath(path: string | null): string {
  if (
    !path?.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    Array.from(path).some((character) => character.charCodeAt(0) <= 32)
  ) {
    return '/today';
  }
  return path;
}

export function onboardingSharingReturn(path: unknown): string | undefined {
  if (typeof path !== 'string' || loginReturnPath(path) !== path) return undefined;
  return /^\/(?:sharing(?:[?#]|$)|shared\/(?:lessons|curriculum)\/[a-z0-9-]+(?:[?#]|$))/i.test(path)
    ? path
    : undefined;
}
