import { describe, expect, it } from 'vitest';

import {
  OnboardingRequestSchema,
  ProfileResponseSchema,
  SchoolOverviewResponseSchema
} from './index.js';

const validOnboardingRequest = {
  fullName: 'Taylor Teacher',
  phone: null,
  workEmail: 'taylor@example.com',
  schoolName: 'Example School',
  district: null,
  state: null,
  subjects: [],
  grades: []
};

const validProfileResponse = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'taylor@example.com',
    fullName: 'Taylor Teacher'
  },
  profile: {
    role: 'teacher',
    phone: null,
    workEmail: 'taylor@example.com',
    subjects: [],
    grades: [],
    onboarded: true
  },
  school: null
};

const validSchoolOverviewResponse = {
  school: {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Example School',
    district: null,
    state: null,
    timezone: 'America/Los_Angeles',
    inviteCode: 'EXAMPLE',
    memberCount: 1
  },
  currentUserId: '00000000-0000-4000-8000-000000000001',
  members: [
    {
      userId: '00000000-0000-4000-8000-000000000001',
      email: 'taylor@example.com',
      fullName: 'Taylor Teacher',
      role: 'teacher',
      subjects: [],
      grades: [],
      joinedAt: '2026-09-10T00:00:00.000Z',
      isCurrentUser: true
    }
  ],
  curriculumLibrary: []
};

describe('Phase 0 role contracts', () => {
  it.each(['teacher', 'admin'] as const)('accepts %s for onboarding', (role) => {
    expect(OnboardingRequestSchema.safeParse({ ...validOnboardingRequest, role }).success).toBe(
      true
    );
  });

  it('rejects department_head for onboarding', () => {
    expect(
      OnboardingRequestSchema.safeParse({ ...validOnboardingRequest, role: 'department_head' })
        .success
    ).toBe(false);
  });

  it.each(['teacher', 'admin'] as const)('accepts %s for profile responses', (role) => {
    expect(
      ProfileResponseSchema.safeParse({
        ...validProfileResponse,
        profile: { ...validProfileResponse.profile, role }
      }).success
    ).toBe(true);
  });

  it('rejects department_head for profile responses', () => {
    expect(
      ProfileResponseSchema.safeParse({
        ...validProfileResponse,
        profile: { ...validProfileResponse.profile, role: 'department_head' }
      }).success
    ).toBe(false);
  });

  it.each(['teacher', 'admin'] as const)('accepts %s for school overview members', (role) => {
    expect(
      SchoolOverviewResponseSchema.safeParse({
        ...validSchoolOverviewResponse,
        members: [{ ...validSchoolOverviewResponse.members[0], role }]
      }).success
    ).toBe(true);
  });

  it('rejects department_head for school overview members', () => {
    expect(
      SchoolOverviewResponseSchema.safeParse({
        ...validSchoolOverviewResponse,
        members: [{ ...validSchoolOverviewResponse.members[0], role: 'department_head' }]
      }).success
    ).toBe(false);
  });
});
