export type GoogleSlidesReference = {
  presentationId: string;
  published: boolean;
  resourceKey: string | null;
};

export function parseGoogleSlidesUrl(value: string): GoogleSlidesReference | null {
  try {
    const url = new URL(value.trim());
    if (!['docs.google.com', 'slides.google.com'].includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/\/presentation\/(?:u\/\d+\/)?d\/(e\/)?([^/]+)/i);
    if (!match?.[2]) return null;
    return {
      presentationId: match[2],
      published: Boolean(match[1]),
      resourceKey: url.searchParams.get('resourcekey')
    };
  } catch {
    return null;
  }
}

export function isGoogleSlidesUrl(value: string): boolean {
  return parseGoogleSlidesUrl(value) !== null;
}

export function buildGoogleSlidesEmbedUrl(value: string, slide: number): string | null {
  const reference = parseGoogleSlidesUrl(value);
  if (!reference) return null;
  const deckPath = reference.published
    ? `/presentation/d/e/${reference.presentationId}/embed`
    : `/presentation/d/${reference.presentationId}/embed`;
  const url = new URL(deckPath, 'https://docs.google.com');
  url.searchParams.set('start', 'false');
  url.searchParams.set('loop', 'false');
  url.searchParams.set('delayms', '60000');
  url.searchParams.set('rm', 'minimal');
  url.searchParams.set('slide', `id.p${Math.max(1, Math.trunc(slide))}`);
  if (reference.resourceKey) url.searchParams.set('resourcekey', reference.resourceKey);
  // Google's minimal embed accepts a one-based id.p slide target. Replacing this
  // URL lets TeacherDesk own navigation instead of depending on iframe input.
  return url.toString();
}
