import { and, eq } from 'drizzle-orm';

import { db, schoolMemberships, teacherProfiles } from '@teacheros/db';

export type SchoolRole = 'teacher' | 'admin';

export type SchoolAccess = {
  schoolId: string;
  role: SchoolRole;
  status: 'active' | 'inactive';
};

// Memberships are the authorization source. The migration backfills every
// existing profile, so a missing row is treated as no access rather than as an
// implicit active membership.
export async function getSchoolAccess(userId: string, schoolId?: string) {
  const [profile] = await db
    .select({ schoolId: teacherProfiles.schoolId })
    .from(teacherProfiles)
    .where(eq(teacherProfiles.userId, userId))
    .limit(1);
  if (!profile || (schoolId && profile.schoolId !== schoolId)) return null;

  const [membership] = await db
    .select({ role: schoolMemberships.role, status: schoolMemberships.status })
    .from(schoolMemberships)
    .where(
      and(eq(schoolMemberships.userId, userId), eq(schoolMemberships.schoolId, profile.schoolId))
    )
    .limit(1);

  if (!membership) return null;

  return {
    schoolId: profile.schoolId,
    role: membership.role,
    status: membership.status
  } satisfies SchoolAccess;
}

export async function canAccessAdminWorkspace(userId: string, schoolId?: string) {
  const access = await getSchoolAccess(userId, schoolId);
  return Boolean(access && access.status === 'active' && access.role === 'admin');
}

export async function canViewSchoolOverview(userId: string, schoolId?: string) {
  const access = await getSchoolAccess(userId, schoolId);
  return Boolean(access && access.status === 'active');
}

export async function canManageSchool(userId: string, schoolId?: string) {
  return canAccessAdminWorkspace(userId, schoolId);
}

export async function canManageMembers(userId: string, schoolId?: string) {
  return canAccessAdminWorkspace(userId, schoolId);
}

export async function canManageInvitePolicy(userId: string, schoolId?: string) {
  return canAccessAdminWorkspace(userId, schoolId);
}

export async function canViewTeacherSchedules(userId: string, schoolId?: string) {
  return canAccessAdminWorkspace(userId, schoolId);
}

export async function canViewSchoolCourses(userId: string, schoolId?: string) {
  return canAccessAdminWorkspace(userId, schoolId);
}

export async function canViewSchoolSharedCurriculum(userId: string, schoolId?: string) {
  return canAccessAdminWorkspace(userId, schoolId);
}

export async function canManageSchoolCalendar(userId: string, schoolId?: string) {
  return canAccessAdminWorkspace(userId, schoolId);
}

export async function canRequestSchoolClaim(userId: string, schoolId?: string) {
  const access = await getSchoolAccess(userId, schoolId);
  return Boolean(access && access.status === 'active');
}

// These explicit denials document the privacy boundary. Admin access is
// operational and school-scoped, never a blanket grant over teacher data.
export function canViewPrivateTeacherNotes(): false {
  return false;
}

export function canViewClassroomPrivateData(): false {
  return false;
}

export function canViewTeacherDraftPlanning(): false {
  return false;
}
