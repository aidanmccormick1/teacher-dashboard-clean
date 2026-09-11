# Teacher Platform Admin System, Full Implementation Plan

We are adding a major new Administrator experience to the existing Teacher Platform.

This must be built as an extension of the existing product, not as a separate disconnected application and not as a rewrite.

The existing Teacher Platform is already teacher-first and includes concepts such as:

- Schools
- Teachers
- Courses
- Class groups / sections
- Meeting schedules
- School calendars
- Year Plan
- Curriculum
- Units
- Lessons
- Lesson steps
- Today
- Classroom execution
- Class meeting history
- Curriculum sharing
- School membership / school joining
- School invite codes or equivalent school joining behavior
- Teacher-specific progress
- Shared curriculum
- Schedule imports
- School closures / special days
- Course schedule patterns

The Administrator platform should use this same underlying system and data model.

The central product principle is:

**Teachers manage teaching. Administrators manage the school environment, school structure, shared planning infrastructure, and high-level status around teaching.**

Administrators should have real visibility and useful management capabilities, but Teacher Platform must NOT become teacher surveillance software.

---

# CRITICAL EXECUTION INSTRUCTIONS

Do NOT attempt this entire project in one giant implementation.

Work through the phases below sequentially.

For each phase:

1. Inspect the existing implementation related to that phase before changing anything.
2. Identify the existing database models, routes, APIs, permissions, services, and UI that should be reused.
3. Make the smallest coherent architectural change that properly supports the long-term system.
4. Do not duplicate systems that already exist.
5. Preserve existing teacher behavior unless this prompt explicitly changes it.
6. Add or update focused tests.
7. Run focused validation for that phase.
8. Fix failures before moving on.
9. Report:
   - What changed
   - Important architecture decisions
   - Files changed
   - Database migrations added
   - Tests added
   - Validation results
   - Remaining known limitations
10. STOP after completing the requested phase unless explicitly instructed to continue.

Do not silently continue into later phases.

When useful, use sub-agents to inspect separate areas such as:

- database/schema
- authentication and permissions
- existing School page
- school invite/join behavior
- Year Plan / schedule logic
- course and section ownership
- curriculum sharing
- tests
- route/navigation architecture

Sub-agents should primarily be used for inspection and focused implementation work. Avoid having multiple agents independently redesign the same architecture.

We are trying to conserve development usage, so inspect carefully before coding and avoid unnecessary broad rewrites.

---

# PRODUCT MODEL

There are currently only two relevant product roles:

```text
Teacher
Administrator
```

REMOVE Department Head from the product completely.

There should be no Department Head option exposed anywhere after Phase 0.

Long term, a person may potentially have different roles in different schools, so avoid assuming one global immutable role attached directly to the user if the current architecture can reasonably support school-specific membership roles.

Preferred conceptual model:

```text
User
  ↓
School Membership
  ├── School A: Teacher
  └── School B: Administrator
```

Supporting multiple schools in the UI does not have to be fully built now, but the architecture should not make this impossible.

---

# ADMIN EXPERIENCE

Administrator should feel like a distinct workspace inside Teacher Platform.

Teachers still use the teacher interface.

Example teacher routes:

```text
/today
/year-plan
/courses
/school
/classroom
/lessons/...
```

Administrator routes should live under something like:

```text
/admin
/admin/teachers
/admin/courses
/admin/schedule
/admin/curriculum
/admin/calendar
/admin/school
```

If an account can access both teacher and administrator experiences, provide a clean workspace switcher later rather than mixing the interfaces together.

An administrator should normally land in the Admin workspace.

---

# PRIVACY MODEL

This is one of the most important requirements in the entire implementation.

Administrator visibility must stop before the platform becomes a surveillance product.

## Teacher-private information

Administrators must NOT automatically gain access to:

- Private teacher notes
- Classroom quick notes
- Raw class notes
- Carry-over notes
- Private planning notes
- AI conversations
- AI-generated private planning
- Internal lesson execution notes
- Classroom checklist state where it is only useful to the teacher
- Detailed interaction history
- Login/activity monitoring
- Exact timestamps of routine teacher actions
- Draft curriculum that a teacher has not shared
- Anything explicitly marked private

Privacy must be enforced in backend authorization, not only hidden in React.

An administrator manually typing an API URL must still not receive private data.

## School-visible operational information

Administrators should be able to see appropriate operational information such as:

- Teacher name
- School membership
- Courses taught
- Sections / class groups taught
- What section meets at what time
- Teacher schedule
- Course meeting pattern
- Current school calendar configuration
- Curriculum associated with a course
- Whether basic Teacher Platform setup is complete
- High-level Year Plan information
- High-level curriculum / pacing information where appropriate
- School-shared curriculum
- School schedule infrastructure

## Explicitly shared information

Administrators can see content that the teacher explicitly shares with the school, including:

- Shared curriculum
- Shared lessons
- Shared course templates
- Shared resources
- School-approved curriculum

Build the system around clear scopes:

```text
PRIVATE
Teacher execution and personal planning

SCHOOL VISIBLE
Operational school/course/schedule information

SHARED
Content intentionally shared with the school
```

Where appropriate, teacher UI should clearly communicate this distinction.

Example:

```text
Class Notes
Private to you
```

versus:

```text
US History Curriculum
Shared with your school
```

---

# ADMINISTRATOR CAPABILITIES

Administrators should eventually be able to manage and understand:

## Teachers

- See school members who are teachers
- Invite teachers
- Remove / deactivate school memberships where appropriate
- See what courses each teacher teaches
- See what sections they teach
- See their teaching schedule
- See what class they are scheduled to teach at a particular time
- See whether required setup is complete
- See high-level curriculum / Year Plan status
- NOT inspect private classroom notes

## Courses

- See all active courses at the school
- See teachers attached to courses
- See class groups / sections
- See class meeting patterns
- See curriculum attached to courses
- See school-shared curriculum
- See high-level course planning status

## Teacher schedules

Administrators should have a useful school-level schedule view.

For example:

```text
Monday 9:00 AM

Sarah Johnson
Period 2
US History
Room 214

Mike Anderson
Period 1
World History
Room 109
```

The system should answer:

> Who is teaching what class, and when?

This should use the existing course → class group / section → meeting time model.

Do NOT create a second administrator-only schedule model.

Potential views:

- Teacher schedule view
- Day view
- Week view
- Course/section schedule
- Filter by teacher
- Filter by course
- Potential future room filter

The first version does not need a complex scheduling optimization engine.

It needs accurate visibility into the schedules that already exist.

---

# ADMIN YEAR PLAN MANAGEMENT

This is different from the weekly bell/meeting schedule.

Administrators should also be able to work with the academic Year Plan / curriculum schedule.

The existing Teacher Platform Year Plan appears to connect:

```text
Course curriculum
+
Class meeting dates
+
School calendar
+
Lesson planning
=
Year Plan
```

Administrators should eventually have visibility into the Year Plan at the school level.

Important distinction:

```text
Teaching Schedule
Who teaches what class at what time

Year Plan
What curriculum is planned across the school year
```

Administrators should be able to view high-level Year Plan information for courses.

Potential admin Year Plan capabilities:

- View course Year Plans
- See units across the academic year
- See curriculum pacing
- See planned unit ranges
- See what curriculum is attached to a course
- See high-level planned progression
- Potentially manage school-level or shared Year Plan templates
- Potentially create / maintain an official school curriculum plan that teachers can adopt

Be careful with permissions.

An administrator should NOT casually overwrite an individual teacher's active Year Plan.

Use a clear model such as:

```text
School curriculum / school Year Plan template
        ↓
Teacher adopts / links / copies it
        ↓
Teacher execution remains teacher-controlled
```

If administrators need to edit actual teacher planning in the future, that should require an explicit product decision.

For the initial version, prioritize:

```text
View
Understand
Provide shared plans
Manage school planning infrastructure
```

rather than:

```text
Administrators directly editing teachers' personal plans
```

---

# SCHOOL CALENDAR

Administrators should eventually manage the authoritative school calendar.

Examples:

- First day of school
- Last day of school
- Holidays
- Breaks
- Teacher work days
- No-school days
- Minimum days
- Testing days
- Special schedules
- Closures
- One-off schedule overrides

This should connect into existing centralized schedule / effective-meeting logic.

Long term:

```text
Administrator manages school calendar
        ↓
School calendar affects effective meetings
        ↓
Teacher Year Plans update
        ↓
Today uses the correct meeting dates
        ↓
Classroom remains aligned
```

Do not duplicate existing School calendar infrastructure.

---

# SCHOOL CLAIMING MODEL

The current product is being tested primarily with teachers.

Teachers are already able to create/join schools and share school codes.

We MUST NOT break that.

Schools must work completely without administrators.

Introduce the concept of:

```text
UNCLAIMED SCHOOL
```

and

```text
CLAIMED SCHOOL
```

## Unclaimed school

This is essentially the current teacher-first system.

Teachers can:

- Create or join the school
- Share school invite codes
- Invite other teachers
- Collaborate
- Share curriculum
- Use Teacher Platform normally

No administrator is required.

Example:

```text
Dana Hills High School

Status: Unclaimed

18 teachers
No administrator
```

The product should work normally.

## Claimed school

Later, an administrator joins and verifies that they should manage the school.

Example:

```text
Dana Hills High School

Status: Claimed

Administrator:
Jane Smith

18 teachers
```

CRITICAL:

The administrator claims the EXISTING school.

Do NOT:

- create another school
- migrate teachers to a replacement school
- duplicate courses
- duplicate curriculum
- regenerate codes unnecessarily
- change school IDs
- detach schedules

Conceptually:

Before:

```text
School ID 123
Teacher A
Teacher B
Teacher C
```

After:

```text
School ID 123
Administrator
Teacher A
Teacher B
Teacher C
```

Same school.

Same IDs.

Same teacher data.

Same curriculum.

Same sections.

Same schedules.

Same history.

---

# ADMIN CLAIM VERIFICATION

Do not allow anyone to instantly click:

```text
I am the administrator
```

and become admin.

Build a claim-request flow.

Early MVP can use manual verification.

Example:

```text
Request administrator access

School:
Dana Hills High School

Name:
Jane Smith

School email:
jsmith@schooldistrict.org

Position:
Principal / Assistant Principal / Administrator

Optional verification information

[Request access]
```

Possible claim states:

```text
none
pending
approved
rejected
```

Do not overbuild automated school verification in the first version.

Manual approval is acceptable initially.

Design the data model so future verification methods could include:

- verified school-domain email
- existing administrator invitation
- district verification
- domain ownership
- manual review

but do not implement all of those yet unless naturally easy.

---

# SCHOOL INVITE CODE MODEL

Current teacher behavior must continue initially.

Teachers currently need the ability to share a school code so other teachers can join.

Do not make school-code invitations administrator-only while the product is still teacher-first.

Initially:

```text
Unclaimed school:
Teachers can share school code
```

After a school is claimed, administrators should eventually receive invitation controls.

Example setting:

```text
Who can invite teachers?

Administrators only
Administrators and teachers
Anyone with the school invite code
```

Default existing claimed schools to something that preserves current behavior, likely:

```text
Administrators and teachers
```

Claiming a school must NOT suddenly lock teachers out of a workflow they already used.

Invitation policy should be managed explicitly.

Potential backend field:

```text
teacherInvitePolicy

admin_only
members
code
```

Exact naming can follow existing architecture.

---

# PHASE 0, AUDIT AND ROLE CLEANUP

## Goal

Understand the current implementation and remove Department Head cleanly.

Do NOT build the Admin workspace yet.

## Audit first

Inspect:

- authentication
- onboarding
- profile
- school membership
- role fields
- role enums
- role conditionals
- school creation
- school joining
- school code handling
- database migrations
- API authorization
- route guards
- tests
- demo/seed fixtures
- copy/text
- settings
- any hidden Department Head references

Use repository-wide search.

## Remove Department Head

Remove Department Head from:

- onboarding
- database enum/options if applicable and migration-safe
- frontend options
- backend validation
- role checks
- settings
- school flows
- seed data
- test data
- type definitions
- schemas
- copy

If old production/dev data could contain department-head values, add a safe migration strategy.

Do not delete or corrupt existing users.

If necessary, map old department-head users to Teacher for now.

## Membership architecture audit

Determine whether current roles are:

```text
user.role
```

or already membership-based.

Recommend the least disruptive path toward:

```text
school_memberships
user_id
school_id
role
```

Do not perform an enormous membership rewrite unless necessary.

## Phase 0 validation

Run focused:

- typecheck
- relevant role tests
- auth tests
- onboarding tests
- build
- migration validation

STOP after Phase 0 and report.

---

# PHASE 1, ADMIN BACKEND FOUNDATION

## Goal

Build the core backend concepts required for Administrators without changing the teacher experience.

## School membership roles

Support:

```text
teacher
administrator
```

Prefer school-specific role membership if compatible with the existing model.

## School claim status

Add appropriate fields/model for:

```text
unclaimed
claimed
```

Potentially:

```text
claim_status
claimed_at
claimed_by_user_id
```

If claim requests deserve their own table, prefer that over stuffing everything into schools.

Possible:

```text
school_claim_requests
id
school_id
requester_user_id
status
school_email
position
verification_notes
created_at
reviewed_at
reviewed_by
```

Use existing naming conventions.

## Permission service

Centralize server-side permission checks.

Potential conceptual functions:

```text
canAccessAdminWorkspace
canViewSchoolOverview
canManageSchool
canManageMembers
canManageInvitePolicy
canViewTeacherSchedules
canViewSchoolCourses
canViewSchoolSharedCurriculum
canManageSchoolCalendar
canRequestSchoolClaim
```

Also explicitly protect teacher data:

```text
canViewPrivateTeacherNotes
canViewClassroomPrivateData
canViewTeacherDraftPlanning
```

Administrators should fail these private checks unless the content belongs to themselves or has been explicitly shared.

Do not rely on frontend hiding.

## Phase 1 tests

Test:

- teacher can use existing teacher APIs
- administrator permissions work
- teacher cannot access admin-only APIs
- admin cannot access another teacher's private notes
- admin can access school-visible data
- cross-school access is denied
- claimed/unclaimed school states work
- existing teacher memberships remain valid

Run focused DB/API/typecheck/build validation.

STOP.

---

# PHASE 2, ADMIN WORKSPACE SHELL

## Goal

Create the Administrator UI framework without yet building every feature.

Add routes:

```text
/admin
/admin/teachers
/admin/courses
/admin/schedule
/admin/curriculum
/admin/calendar
/admin/school
```

If existing route naming makes another structure cleaner, keep the same conceptual organization.

## Navigation

Admin navigation:

```text
Overview
Teachers
Courses
Schedule
Curriculum
Calendar
School
```

Keep the design consistent with Teacher Platform.

It should feel like the same product family, not a completely unrelated SaaS dashboard.

## Access control

Teacher without admin role:

```text
/admin
```

must be denied or redirected safely.

Admin should land in admin workspace when appropriate.

## Overview V1

Use real existing data only.

Potential cards / status:

```text
Teachers
24

Courses
41

Sections
86

Curriculum connected
29 / 41

Schedule setup
21 / 24 teachers

School calendar
Configured
```

Do NOT add fake activity analytics.

Do NOT create:

- login frequency
- teacher rankings
- time-on-platform
- productivity score

## Phase 2 validation

Test:

- admin routes load
- teacher blocked
- school isolation
- no private data exposed
- responsive layout
- route navigation
- build/typecheck

STOP.

---

# PHASE 3, ADMIN TEACHERS

## Goal

Build the school Teacher management surface.

## Teacher list

Show relevant school members.

Potential columns/cards:

```text
Teacher
Courses
Sections
Schedule setup
Curriculum setup
Membership status
```

Avoid excessive table density if cards or grouped rows fit the existing UI better.

## Teacher detail

Admin can inspect:

- teacher name
- school membership
- courses taught
- sections taught
- scheduled meeting times
- curriculum attached
- high-level setup information
- high-level Year Plan status if available

Admin must NOT see:

- private notes
- Classroom notes
- quick notes
- private AI data
- granular teacher activity log
- teacher-specific private lesson execution data

## Membership actions

Do not yet overbuild account management.

Support appropriate actions such as:

- invite
- deactivate/remove from school if safe
- resend invite if invitations exist
- basic role status

Do not delete the user's personal account when removing them from a school.

## Phase 3 validation

Test:

- accurate teacher roster
- teacher-course relationships
- teacher-section relationships
- no cross-school leakage
- removal affects membership, not account
- private data inaccessible

STOP.

---

# PHASE 4, ADMIN SCHEDULE VIEW

## Goal

Allow administrator to understand who is teaching what and when.

Reuse the existing:

```text
Course
→ Class Group / Section
→ Meeting Time
```

Do not create duplicate schedules.

## Build admin schedule

Support a useful schedule interface.

At minimum:

- Today / day view
- Week view if practical
- Filter by teacher
- Filter by course
- Click teacher
- Click section/course

Display:

```text
Teacher
Course
Section
Start time
End time
Meeting days
Room if available
```

Example:

```text
9:00 - 9:50
Sarah Johnson
US History
Period 2

9:00 - 10:20
Mike Anderson
World History
Block A
```

The administrator should quickly answer:

- Who is teaching now?
- Who teaches at 10:00?
- What does Sarah teach today?
- When does US History meet?
- Which teacher is attached to this section?

## Important schedule concerns

Handle:

- arbitrary weekdays
- multiple meeting times
- split periods if supported
- schedule imports
- timezone
- special days / overrides
- classes with incomplete schedule setup

Do not silently fabricate missing meetings.

## Phase 4 validation

Test:

- meeting projection uses existing schedule service
- timezone correctness
- filters
- multi-section courses
- arbitrary meeting patterns
- school isolation

STOP.

---

# PHASE 5, ADMIN COURSES

## Goal

Provide a school-level view of what courses exist and who teaches them.

## Course list

Show:

- course
- teachers
- sections
- meeting count/pattern where useful
- curriculum status
- active/archived status if available

Be careful about the existing model where two teachers may have separate course records that happen to have the same name.

Do not automatically merge records based only on matching names.

If a future normalized school-course catalog is useful, document it separately rather than introducing risky deduplication now.

## Course detail

Admin may see:

- course metadata
- teachers
- sections
- schedule
- linked/shared curriculum
- high-level Year Plan information

Do not expose teacher-private notes.

## Phase 5 validation

Test:

- active courses
- archived behavior
- teacher relationships
- section relationships
- curriculum references
- no accidental course merging

STOP.

---

# PHASE 6, YEAR PLAN VISIBILITY AND SCHOOL PLANNING

## Goal

Allow administrators to understand curriculum planning over the academic year without taking control away from teachers.

This phase requires careful inspection of the existing Year Plan architecture before implementation.

## Admin visibility

For a course, show appropriate high-level information such as:

- Units
- Unit order
- Planned unit ranges
- Lessons / curriculum structure where school-visible
- Approximate position in curriculum
- Section context
- academic calendar projection

Use existing effective meeting logic.

## Privacy / control rule

Admin should primarily have:

```text
View
Understand
Provide shared curriculum
Provide shared Year Plan template
```

Not:

```text
Directly edit teacher's live personal Year Plan
```

unless something is explicitly school-owned/shared.

## School-level Year Plan concept

If architecture supports it cleanly, introduce the ability for curriculum to have a school-owned or shared planning template.

For example:

```text
Official US History Curriculum

Unit 1
Aug 18 - Sep 5

Unit 2
Sep 8 - Oct 2
```

Teachers may then:

- use it
- copy it
- link/adopt it
- adjust their own execution

Do not force synchronization in a destructive way.

If this needs a larger architecture redesign, document it instead of hacking it into teacher plans.

## Phase 6 validation

Test:

- admin sees permitted curriculum planning
- teacher private planning remains private
- section schedule projection remains independent
- admin viewing causes no mutation
- changing admin view does not alter teacher Year Plan

STOP.

---

# PHASE 7, SCHOOL CLAIM FLOW

## Goal

Allow existing teacher-created schools to later become administrator-managed.

## Administrator onboarding

When user chooses Administrator:

```text
Find your school
```

Search existing schools before offering to create another.

If match exists:

```text
Dana Hills High School
18 teachers already using Teacher Platform

Request administrator access
```

If no match exists, use existing school creation behavior carefully.

## Claim request

Collect minimal information:

- school
- administrator name
- school email
- position/title
- optional verification detail

Store request.

Possible status:

```text
pending
approved
rejected
```

## Existing schools

Claim IN PLACE.

This is non-negotiable.

Do not change:

- school ID
- teachers
- courses
- curriculum
- history
- schedule
- membership
- sharing relationships

## Manual approval

Create a safe mechanism for manually approving a claim.

This can be operational/developer-controlled initially if an internal admin dashboard is unnecessary.

Document exactly how approval occurs.

## Phase 7 validation

Test:

- existing teacher-created school can be claimed
- no duplicate school created
- pending claim grants no admin permissions
- approved claim grants admin permissions
- rejected claim grants nothing
- other schools unaffected
- teacher workflows unaffected

STOP.

---

# PHASE 8, INVITE CODE AND MEMBERSHIP POLICY

## Goal

Preserve existing teacher-led growth while allowing administrators eventual control.

## Unclaimed schools

Preserve current behavior.

Teachers can continue sharing school codes.

## Claimed schools

Add invitation policy.

Conceptually:

```text
Who can invite teachers?

Administrators only
Administrators and teachers
Anyone with the school code
```

Exact implementation should fit current invitation/code architecture.

Default claimed schools should preserve existing behavior.

Do not claim a school and suddenly invalidate all teacher workflows.

## Code security

Inspect:

- code generation
- code uniqueness
- expiration if any
- revocation
- regeneration
- abuse risks
- whether codes reveal school IDs
- joining duplicate memberships
- removed users rejoining

Add appropriate protections without making onboarding painful.

## Membership edge cases

Test:

- user already belongs to school
- invalid code
- expired/revoked code if supported
- removed teacher
- administrator invitation
- teacher invitation
- claim transition
- school with no admin
- school with admin
- duplicate membership

STOP.

---

# PHASE 9, ADMIN CURRICULUM

## Goal

Build a school curriculum library around the existing curriculum-sharing system.

Do NOT create a parallel curriculum engine.

Inspect the existing sharing architecture first.

## Admin curriculum page

Show:

- School-shared curricula
- Course source
- Owner / contributor
- Grade/subject if available
- Last update
- usage/adoption if safely available

## Admin capabilities

Potentially:

- View shared curriculum
- Add school-owned curriculum
- Create from shared curriculum
- Duplicate
- Archive
- Feature/recommend
- Mark as school-approved / official if product model supports it cleanly

Do not silently take ownership of teacher-created content.

Clearly distinguish:

```text
Teacher-shared
```

from:

```text
School-owned
```

## Adoption

Teachers should be able to:

- copy curriculum
- link/use curriculum
- retain independent destination IDs
- preserve schedules
- preserve section history

Reuse the existing copy/share architecture.

## Phase 9 validation

Test:

- sharing
- permissions
- ownership
- duplication
- destination independence
- source unchanged
- school isolation
- archived behavior

STOP.

---

# PHASE 10, ADMIN SCHOOL CALENDAR

## Goal

Make administrators the authoritative manager of school-wide calendar infrastructure once a school has an admin.

Reuse the existing School calendar system.

## Admin controls

Manage:

- first day
- last day
- breaks
- holidays
- no-school days
- special days
- minimum days if supported
- closures
- schedule overrides

## Existing teacher-created calendar

Be extremely careful when an administrator claims a school that already has calendar data.

Do not silently overwrite teacher-created school calendar data.

The school already exists.

Treat existing shared school-level calendar data as existing school data.

If individual teachers currently have conflicting calendar data, inspect architecture and create a migration/reconciliation plan rather than guessing.

## Effective meeting service

All admin calendar changes should flow through the centralized schedule logic.

Verify effects on:

- Today
- Year Plan
- Classroom
- effective section meetings
- projected dates
- schedule overrides

## Phase 10 validation

Use regression tests around:

- holidays
- arbitrary weekdays
- minimum/special days if supported
- Year Plan projection
- Today
- classroom meeting identity
- closures
- overrides

STOP.

---

# PHASE 11, ADMIN STATUS INTELLIGENCE

## Goal

Give administrators useful school-level status without teacher surveillance.

Build aggregate, operational information.

Possible information:

```text
Teachers
24

Schedule setup complete
21 / 24

Courses
41

Courses with curriculum
34 / 41

School-shared curricula
12

Sections
86

School calendar
Configured
```

Potential future pacing information:

```text
Courses within planned pacing
82%
```

But only implement pacing if the existing data can support it honestly.

Do not manufacture fake metrics.

## Avoid

Do not build:

- productivity score
- teacher ranking
- login tracking dashboard
- inactive-teacher alerts based merely on usage
- time spent in app
- number of clicks
- private note analysis
- private AI usage analysis
- detailed teacher behavioral history

Administrator status should answer:

> Is the school's instructional planning infrastructure set up and generally functioning?

Not:

> Is this teacher working hard enough?

## Phase 11 validation

Test calculation correctness and ensure no private data is being used in aggregate without an explicit decision.

STOP.

---

# PHASE 12, FULL PRIVACY AND SECURITY REVIEW

## Goal

Try to break the system.

Use focused sub-agents if helpful.

Audit every Admin API and query.

Test scenarios:

### Cross-school

Administrator at School A attempts to access:

- School B teacher
- School B course
- School B section
- School B schedule
- School B shared curriculum
- School B private data

Everything must fail.

### Private teacher data

Administrator attempts direct API access to:

- notes
- classroom notes
- raw class meeting notes
- drafts
- carry-over text
- private lesson planning
- private AI data

Must fail.

### Teacher admin escalation

Teacher attempts:

- `/admin`
- admin APIs
- membership management
- school claim approval
- invitation setting changes
- calendar admin actions

Must fail unless explicitly permitted.

### Claim abuse

Test:

- pending claim
- duplicate claim
- competing claims
- rejected claim
- approved claim
- administrator removed
- school loses last administrator
- admin attempts to claim other school

Document how edge cases are handled.

STOP.

---

# PHASE 13, FULL END-TO-END REGRESSION

## Goal

Ensure building Admin did not damage the existing teacher product.

Test the teacher system end-to-end.

At minimum verify:

- login
- teacher onboarding
- school creation
- join via school code
- courses
- sections
- schedule import
- arbitrary meeting patterns
- School calendar
- Year Plan
- section context
- lesson creation
- lesson workspace
- curriculum copying
- curriculum sharing
- Today
- Classroom
- progress
- class meeting history
- notes
- lesson sharing
- schedule overrides
- school membership
- admin claim transition

Critical regression:

A school with zero administrators must still function correctly.

Administrator functionality is additive.

---

# IMPORTANT DATA OWNERSHIP PRINCIPLES

Do not assume everything attached to a school belongs to the administrator.

Use appropriate ownership.

Examples:

```text
School owns:
School identity
School calendar
School membership
Invite policy
School-owned curriculum

Teacher owns:
Private notes
Private drafts
Private classroom execution
Teacher-created content unless shared/transferred

Shared:
Explicitly shared curriculum/resources
```

Do not change ownership merely because an administrator claims the school.

---

# UI PRINCIPLES

The admin UI should follow the existing Teacher Platform design language.

Do not create a generic enterprise dashboard filled with random cards.

Priorities:

- clear hierarchy
- useful density
- full-screen utilization
- fewer words
- actionable status
- strong schedule visualization
- clear filters
- clean tables only where appropriate
- obvious privacy boundaries

The strongest admin surfaces should probably be:

```text
Overview
Teacher schedules
Teachers
Courses
Curriculum
Year Plan visibility
School calendar
```

---

# FUTURE CAPABILITIES, DO NOT BUILD NOW

Architecture can leave room for these, but do NOT expand scope into them:

- Student information system
- Attendance
- Gradebook
- HR
- Payroll
- Teacher evaluations
- Formal observation system
- Discipline
- Parent messaging
- Student behavior management
- Teacher performance scoring
- Substitute management
- room optimization
- district-wide hierarchy
- department heads
- district administrators

Do not build Department Head.

We intentionally removed that scope.

---

# DATABASE / MIGRATION SAFETY

Every database migration should:

- preserve existing IDs
- preserve existing schools
- preserve existing teachers
- preserve curriculum
- preserve schedules
- preserve class history
- avoid destructive defaults
- be backward-compatible where possible
- include safe handling for existing role values
- avoid silently assigning administrator privileges

Never use a migration that accidentally turns the person who created a school into an Administrator unless that is explicitly intended.

Teacher-created school does NOT mean administrator-owned school.

---

# TESTING STRATEGY

Do not repeatedly run the entire test suite after every tiny edit if it wastes time.

For each phase:

1. Run focused tests while implementing.
2. Run relevant package typecheck.
3. Run relevant build.
4. Run relevant DB/API integration tests.
5. Run broader regression at major architectural boundaries.

At final phase, run the full appropriate suite.

If a repository already has established testing commands, reuse them.

Do not create redundant testing infrastructure.

---

# FINAL PRODUCT BEHAVIOR

Teacher experience:

```text
I can create or join my school.
I can teach without an administrator existing.
My personal teaching information remains private.
I can share curriculum when I want.
My school's calendar and schedule infrastructure helps power my planning.
```

Administrator experience:

```text
I can understand who teaches what.
I can see when classes meet.
I can understand the school's courses and sections.
I can see high-level Year Plans.
I can manage school planning infrastructure.
I can manage the school calendar.
I can manage membership and invitation policy.
I can manage school-shared curriculum.
I can understand whether the school is set up and on track.
I cannot casually read teachers' private classroom information.
```

School lifecycle:

```text
Teacher creates school
        ↓
More teachers join using existing teacher-first workflows
        ↓
School operates normally without admin
        ↓
Administrator discovers existing school
        ↓
Administrator submits claim
        ↓
Claim verified
        ↓
EXISTING school becomes claimed
        ↓
Admin workspace becomes available
        ↓
Teachers keep all existing data and workflows
```

---

# STARTING INSTRUCTION

Begin ONLY with **Phase 0: Audit and Role Cleanup**.

Before editing, inspect the repository thoroughly enough to understand:

- current role architecture
- school membership
- school codes
- school creation/joining
- auth
- permissions
- current database schema
- Teacher School page
- sharing architecture
- schedule architecture
- Year Plan architecture
- calendar architecture

Use sub-agents for parallel inspection if useful.

Then implement Phase 0.

Do not start Phase 1.

At the end, provide a concise but complete implementation report, validation results, and anything Phase 1 needs to know.
