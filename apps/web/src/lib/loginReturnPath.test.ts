import { describe, expect, it } from 'vitest';
import { loginReturnPath, onboardingSharingReturn } from './loginReturnPath.js';

describe('sharing sign-in destination', () => {
  it.each(['/sharing?invitation=123', '/shared/lessons/token#add-to-course'])(
    'preserves %s',
    (path) => expect(loginReturnPath(path)).toBe(path)
  );

  it.each([
    '//outside.example',
    '/\\outside.example',
    '/\t/outside.example',
    'https://outside.example'
  ])('rejects %s', (path) => expect(loginReturnPath(path)).toBe('/today'));
});

describe('onboarding sharing destination', () => {
  it.each(['/sharing?invitation=123', '/shared/lessons/token#add-to-course'])(
    'resumes %s',
    (path) => {
      expect(onboardingSharingReturn(path)).toBe(path);
    }
  );
  it('rejects external destinations', () => {
    expect(onboardingSharingReturn('//outside.example')).toBeUndefined();
  });
});
