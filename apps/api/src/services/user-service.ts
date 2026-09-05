import { and, eq } from 'drizzle-orm';

import { db, schools, teacherProfiles, users } from '@teacheros/db';
import type { OnboardingRequest } from '@teacheros/contracts';

type Principal = {
  clerkUserId: string;
  email: string | null;
};

export async function getUserByClerkId(clerkUserId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email
    })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  return user ?? null;
}

export async function ensureUserFromPrincipal(principal: Principal) {
  const fallbackEmail = principal.email ?? `${principal.clerkUserId}@placeholder.local`;

  const existingUser = await getUserByClerkId(principal.clerkUserId);
  if (existingUser) {
    // A work email chosen during onboarding is the address we use for sharing
    // and collaboration. Do not replace it with an absent Clerk claim (which
    // previously reverted Google users to a generated placeholder address).
    // A generated placeholder is upgraded from the saved work email first,
    // then from Clerk's verified sign-in email when no profile exists yet.
    const [profile] = await db
      .select({ workEmail: teacherProfiles.workEmail })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, existingUser.id))
      .limit(1);
    const preferredEmail = profile?.workEmail ?? principal.email;

    if (
      preferredEmail &&
      existingUser.email.endsWith('@placeholder.local') &&
      existingUser.email !== preferredEmail
    ) {
      const [updatedUser] = await db
        .update(users)
        .set({ email: preferredEmail, updatedAt: new Date() })
        .where(eq(users.id, existingUser.id))
        .returning({ id: users.id, email: users.email });
      if (updatedUser) return updatedUser;
    }

    return existingUser;
  }

  const [user] = await db
    .insert(users)
    .values({
      clerkUserId: principal.clerkUserId,
      email: fallbackEmail
    })
    .returning({
      id: users.id,
      email: users.email
    });

  if (!user) {
    throw new Error('Failed to upsert user');
  }

  return user;
}

export async function upsertOnboarding(principal: Principal, payload: OnboardingRequest) {
  const user = await ensureUserFromPrincipal(principal);

  return db.transaction(async (tx) => {
    const existingSchool = await tx
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.name, payload.schoolName))
      .limit(1);

    let schoolId = existingSchool[0]?.id;
    if (!schoolId) {
      const [createdSchool] = await tx
        .insert(schools)
        .values({
          name: payload.schoolName,
          district: payload.district,
          state: payload.state
        })
        .returning({ id: schools.id });
      if (!createdSchool) throw new Error('Failed to create school');
      schoolId = createdSchool.id;
    }

    await tx
      .insert(teacherProfiles)
      .values({
        userId: user.id,
        schoolId,
        role: payload.role,
        onboarded: true,
        phone: payload.phone,
        workEmail: payload.workEmail,
        subjects: payload.subjects,
        grades: payload.grades
      })
      .onConflictDoUpdate({
        target: teacherProfiles.userId,
        set: {
          schoolId,
          role: payload.role,
          onboarded: true,
          phone: payload.phone,
          workEmail: payload.workEmail,
          subjects: payload.subjects,
          grades: payload.grades,
          updatedAt: new Date()
        }
      });

    await tx
      .update(users)
      .set({
        fullName: payload.fullName,
        email: payload.workEmail,
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id));

    const [profile] = await tx
      .select({
        userId: teacherProfiles.userId,
        schoolId: teacherProfiles.schoolId
      })
      .from(teacherProfiles)
      .where(and(eq(teacherProfiles.userId, user.id), eq(teacherProfiles.onboarded, true)))
      .limit(1);

    if (!profile) {
      throw new Error('Failed to load teacher profile after onboarding');
    }

    return {
      userId: profile.userId,
      schoolId: profile.schoolId
    };
  });
}
