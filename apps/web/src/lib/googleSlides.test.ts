import { describe, expect, it } from 'vitest';

import {
  buildGoogleSlidesEmbedUrl,
  isGoogleSlidesUrl,
  parseGoogleSlidesUrl
} from './googleSlides.js';

describe('Google Slides links', () => {
  it('detects edit, account-scoped, and published presentation links', () => {
    expect(
      isGoogleSlidesUrl('https://docs.google.com/presentation/d/deck_123/edit#slide=id.p')
    ).toBe(true);
    expect(
      parseGoogleSlidesUrl('https://docs.google.com/presentation/u/1/d/deck_456/edit')
    ).toMatchObject({ presentationId: 'deck_456', published: false });
    expect(
      parseGoogleSlidesUrl('https://docs.google.com/presentation/d/e/published_789/pub')
    ).toMatchObject({ presentationId: 'published_789', published: true });
  });

  it('does not classify another Google document as Slides', () => {
    expect(isGoogleSlidesUrl('https://docs.google.com/document/d/document_123/edit')).toBe(false);
    expect(isGoogleSlidesUrl('https://example.com/presentation/d/deck_123/edit')).toBe(false);
  });

  it('builds a minimal embed at the requested one-based slide', () => {
    const embed = buildGoogleSlidesEmbedUrl(
      'https://docs.google.com/presentation/d/deck_123/edit?resourcekey=abc',
      4
    );
    expect(embed).toContain('/presentation/d/deck_123/embed?');
    expect(embed).toContain('rm=minimal');
    expect(embed).toContain('resourcekey=abc');
    expect(embed).toContain('slide=id.p4');
  });
});
