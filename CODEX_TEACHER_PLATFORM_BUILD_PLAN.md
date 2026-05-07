# Teacher Platform Build Instructions for Codex

## Purpose

Use this file as the main implementation brief for building out the Teacher Platform over the next several weeks.

The goal is to evolve the current React + Vite + Supabase teacher app into a polished teacher operating system. The product should help teachers manage the real chaos of teaching: shifting schedules, unfinished lessons, different sections moving at different speeds, school holidays, pacing gaps, class notes, and the constant need to remember where each class left off.

This is not a generic lesson plan app. It should become a daily planning, classroom execution, and lesson continuity platform.

The app should feel simple on the surface, but smart underneath. AI should be baked into practical workflows, not exposed as a generic chatbot or gimmick.

---

## Product North Star

A teacher should be able to open the app and immediately know:

```txt
This is the class I am teaching.
This is where they left off.
This is what I should do next.
This is what I need to remember after class.
This is how today affects the rest of the week.
```

Every build decision should support that goal.

---

## Current App Context

The current app is a teacher-facing web app built with:

- React
- Vite
- Supabase
- Serverless API endpoints
- AI-powered parsing and generation features

The current app already supports or partially supports:

- Authentication
- Onboarding
- School setup
- Course management
- Section management
- Schedule building
- Daily dashboard
- Active class detection
- Curriculum planning
- Lesson progress tracking
- Lesson segments
- Carry-over notes
- Class notes
- School holidays
- AI schedule parsing
- AI lesson continuity generation
- AI unit and segment generation
- Profile management
- Account deletion

Current route structure:

```txt
/login
/onboarding
/dashboard
/school
/classroom
/curriculum
/courses/:id
/schedule
/sections/:sectionId/lessons/:lessonId
/profile
```

Keep this route structure unless a change is clearly necessary.

---

## Non-Negotiable Product Principles

### 1. Daily teaching comes first

The most important workflow is not long-term curriculum planning. It is the teacher opening the app during a real school day and knowing what to do next.

Prioritize:

- Current class
- Next class
- Today’s schedule
- Where each section stopped
- Carry-over notes
- Progress by section
- Fast class notes
- Quick progress saving

### 2. Different sections move at different speeds

Never assume all sections attached to the same course are at the same place.

The app must support section-specific:

- Current lesson
- Current segment
- Completed segments
- Stopped-at point
- Carry-over note
- Pacing status
- Next suggested action

### 3. Plans and reality must be separate

The app must distinguish between:

- What was planned
- What actually happened
- What needs to happen next

A lesson plan is not the same as lesson progress. A planned date is not proof that a class completed that lesson.

### 4. AI must save into real app structures

AI output should not be disposable text.

AI should return structured data that can be reviewed, edited, and saved into the database.

Bad AI pattern:

```txt
Generate a long lesson plan in a text box and make the teacher copy it.
```

Good AI pattern:

```txt
Generate editable lesson segments and save them into the lesson_segments table after teacher review.
```

### 5. AI should feel invisible

Avoid making the app feel like a chatbot product.

Use practical actions:

- Parse schedule
- Build lesson segments
- Clean up notes
- Generate recap
- Plan next class
- Suggest weekly plan
- Find pacing issues

Avoid generic buttons like:

- Ask AI
- Chat with AI
- Generate content

### 6. The schedule is the engine

Schedule data powers:

- Dashboard
- Current class detection
- Next class detection
- Pacing calculations
- Remaining meetings
- Holiday interruptions
- Weekly planning

Bad schedule data makes the entire app feel unreliable.

### 7. Teachers need speed, not decoration

The interface should be dense, readable, and fast.

Avoid:

- Large decorative cards
- Empty dashboard space
- Overly generic SaaS layout
- Long AI outputs
- Too many clicks for basic actions
- Hidden critical information

Prefer:

- Compact planning sheet layouts
- Clear primary actions
- Fast scanning
- One-click resume
- One-click save stopping point
- Inline editing
- Practical AI actions

---

## Recommended Multi-Week Build Plan

This plan is organized by priority, not strict calendar dates. Work through it in order unless a dependency requires otherwise.

---

# Phase 1: Stabilize Core Data and Shared Logic

## Goal

Create the foundation needed for reliable dashboard, schedule, classroom, and lesson continuity features.

## Key Problem

The current app appears to have strong screens, but repeated logic is likely spread across pages. The next build pass should centralize business logic so the app behaves consistently.

## Build Tasks

### 1. Create shared service files

Add or improve shared service modules for Supabase data access.

Suggested structure:

```txt
src/services/
  teacherService.js
  schoolService.js
  courseService.js
  sectionService.js
  scheduleService.js
  lessonService.js
  lessonProgressService.js
  classNotesService.js
  holidayService.js
  aiService.js
```

Each service should own database access for that object.

Do not keep repeated Supabase queries inside page components if the query is used in more than one place.

### 2. Create shared hooks

Add or improve hooks for common teacher workflows.

Suggested structure:

```txt
src/hooks/
  useTeacherContext.js
  useTodaySchedule.js
  useActiveClass.js
  useNextClass.js
  useLessonProgress.js
  useSectionProgress.js
  useContinuitySummary.js
  useHolidays.js
  usePacingStatus.js
```

These hooks should handle loading states, errors, and empty states consistently.

### 3. Create schedule utility functions

Add a schedule logic file.

Suggested file:

```txt
src/lib/scheduleUtils.js
```

Required functions:

```txt
getTodayScheduleEntries(date, scheduleEntries, holidays, overrides)
getCurrentClass(now, todayScheduleEntries)
getNextClass(now, todayScheduleEntries)
isClassInSession(now, scheduleEntry)
applyScheduleOverrides(date, scheduleEntries, overrides)
isHoliday(date, holidays)
getRemainingMeetings(sectionId, startDate, endDate, scheduleEntries, holidays, overrides)
```

### 4. Create lesson progress utility functions

Suggested file:

```txt
src/lib/lessonProgressUtils.js
```

Required functions:

```txt
getCompletionPercentage(segments, completedSegmentIds)
getCurrentSegment(segments, progress)
getStoppedAtSegment(segments, progress)
getNextUnfinishedSegment(segments, completedSegmentIds)
getProgressStatus(segments, completedSegmentIds, stoppedAtSegmentId)
buildCarryOverSummary(progress, lesson, segments, notes)
```

### 5. Add clear status values

Use explicit lesson progress statuses.

Recommended statuses:

```txt
not_started
in_progress
stopped_at_segment
completed
carried_over
skipped
needs_reteach
```

Do not rely only on percentage completion.

## Acceptance Criteria

Phase 1 is complete when:

- Page components no longer contain major repeated Supabase queries.
- Dashboard, Classroom, and Lesson Tracker use shared schedule and progress logic.
- Active class and next class detection come from one shared source.
- Lesson progress status is explicit and consistent.
- Empty, loading, and error states are handled without breaking the page.

---

# Phase 2: Rebuild Dashboard as Today’s Planning Sheet

## Goal

Turn `/dashboard` into the teacher’s daily command center.

The dashboard should answer:

- What am I teaching today?
- What class is happening now?
- What class is next?
- Where did each class leave off?
- What needs attention?
- What schedule disruptions are coming?

## Dashboard Layout Requirements

The dashboard should feel like a high-density planning sheet.

Recommended sections, top to bottom:

```txt
1. Current Class
2. Next Class
3. Today’s Schedule
4. Section Progress Snapshot
5. Stopped-At and Carry-Over Notes
6. Pacing Warnings
7. Upcoming Holidays or Schedule Changes
8. Quick Notes
```

## Current Class Card

Show:

- Section name
- Course name
- Period or block
- Start and end time
- Current lesson
- Current segment
- Stopped-at note
- Carry-over note
- Primary action: Resume Class

Actions:

```txt
Resume Class
Open Lesson Tracker
Add Quick Note
Generate Recap
```

If there is no current class, show the next class and the time until it starts.

## Next Class Card

Show:

- Section
- Course
- Time
- Lesson
- Last stopping point
- Suggested first action

Actions:

```txt
Prep Next Class
Open Lesson
Generate Continuity
```

## Today’s Schedule

Show all class meetings for the day in order.

Each row should show:

- Time
- Section
- Course
- Lesson progress
- Status badge
- Stopped-at segment
- Quick action

Status badges:

```txt
Now
Next
Done
Later
No lesson set
Behind
```

## Section Progress Snapshot

For sections meeting today, show:

- Current lesson
- Completion percentage
- Current segment
- Last taught date
- Pacing label

Pacing labels:

```txt
Ahead
On track
Slightly behind
Behind
No data
```

## Stopped-At and Carry-Over Notes

Show only useful notes, not every note.

Prioritize:

- Notes for classes meeting today
- Notes from the most recent class meeting
- Notes marked as carry-over
- Notes attached to incomplete lessons

Each item should show:

- Section
- Lesson
- Note preview
- Last updated
- Action to open lesson tracker

## Pacing Warnings

Show concise warnings only when useful.

Examples:

```txt
Period 3 is one segment behind Period 5.
Period 2 has not completed Lesson 4 and has not met for 5 days.
AP History has 8 meetings left before the unit target date.
```

## Upcoming Holidays or Schedule Changes

Show:

- Holiday name
- Date
- Affected classes
- Impact on pacing if available

## Quick Notes

Allow the teacher to quickly add a note from the dashboard.

Fields:

- Section selector
- Lesson selector if applicable
- Note text
- Note type

Note types:

```txt
class_note
carry_over
pacing_note
lesson_adjustment
student_issue
reminder
```

## Acceptance Criteria

Phase 2 is complete when:

- Dashboard clearly prioritizes today.
- Current class and next class are obvious.
- Each section meeting today shows where it left off.
- Teacher can add a quick note without leaving the dashboard.
- Teacher can open Classroom Mode or Lesson Tracker from the dashboard.
- Dashboard uses real schedule and lesson progress data where available.
- Placeholder or simulated pacing is clearly removed or isolated.

---

# Phase 3: Build Classroom Mode for Fast In-Class Use

## Goal

Make `/classroom` the fastest screen in the app.

This page should be usable while a teacher is actively teaching.

## Core Behavior

Classroom Mode should:

1. Detect the current class from the schedule.
2. Let the teacher override the detected section.
3. Load the current lesson and lesson progress for that section.
4. Show the current segment and unfinished segments.
5. Let the teacher mark progress quickly.
6. Let the teacher save where the class stopped.
7. Let the teacher generate a short next-class recap.

## Page Layout

Recommended layout:

```txt
Top Bar:
- Current section
- Course
- Period/block
- Time remaining if class is active
- Section override dropdown

Main Area:
- Current lesson title
- Objective or lesson summary
- Current segment
- Segment checklist

Right/Bottom Panel:
- Last time recap
- Carry-over note
- Quick class note
- End class action
```

## Required Actions

```txt
Mark Segment Complete
Undo Segment Complete
Save Stopping Point
Add Quick Note
Generate Next-Class Recap
End Class
Open Full Lesson Tracker
```

## Segment Checklist

Each segment should show:

- Segment title
- Segment type
- Estimated minutes
- Completion state
- Current segment marker

Segment states:

```txt
Not started
Current
Complete
Skipped
Needs reteach
```

## End Class Flow

When the teacher clicks `End Class`, show a small confirmation panel.

Fields:

- Stopped at segment
- What happened today?
- What should I remember next time?
- Mark unfinished segments as carry-over
- Generate recap option

Save to:

- lesson_progress
- class_notes
- carry-over note field
- continuity summary if generated

## AI Continuity in Classroom Mode

The AI output must be short.

Target length:

```txt
2 to 4 sentences
```

It should include:

- What was completed
- Where the class stopped
- What to start with next time
- Any pacing warning

Example:

```txt
Period 3 finished the warm-up and discussion, but stopped before the document activity. Start next class by reviewing the discussion question, then move into Segment 3. This section is one segment behind Period 5.
```

## Acceptance Criteria

Phase 3 is complete when:

- Classroom Mode loads the correct active class.
- Teacher can override the active section.
- Teacher can mark segments complete with one click.
- Teacher can save a stopping point.
- End Class flow saves useful continuity data.
- AI recap is short, editable, and saved only after teacher confirmation.
- Page remains fast and uncluttered.

---

# Phase 4: Improve Lesson Tracker and Section-Specific Progress

## Goal

Make `/sections/:sectionId/lessons/:lessonId` the detailed source of truth for section-specific lesson progress.

## Required Data

The Lesson Tracker must load:

- Section
- Course
- Unit
- Lesson
- Lesson segments
- Existing lesson progress for that section
- Class notes for that section and lesson
- Carry-over notes
- Related schedule context
- Other sections attached to the same course for comparison

## Main Features

### 1. Segment progress

Teacher can:

- Mark segment complete
- Undo complete
- Mark skipped
- Mark needs reteach
- Set current segment
- Save stopped-at segment

### 2. Notes

Teacher can add:

- Class note
- Carry-over note
- Pacing note
- Lesson adjustment
- Student issue
- Reminder

Notes should autosave or save quickly.

### 3. Continuity panel

Show:

- Last taught date
- Last stopped-at segment
- Most recent carry-over note
- AI-generated continuity summary if available
- Button to regenerate continuity

### 4. Section comparison

If multiple sections use the same course and lesson, show a compact comparison.

Example:

```txt
Period 2: Segment 2, in progress
Period 3: Segment 4, completed
Period 5: Segment 3, stopped
```

This helps the teacher understand pacing differences.

## Acceptance Criteria

Phase 4 is complete when:

- Lesson Tracker fully supports section-specific progress.
- Stopped-at segment is explicitly stored.
- Notes are tied to section, lesson, and date.
- Continuity summary uses actual progress and notes.
- Teacher can compare progress across sections.
- No lesson progress is overwritten accidentally.

---

# Phase 5: Strengthen Schedule Builder and Schedule Intelligence

## Goal

Make `/schedule` reliable enough to power the entire app.

## Schedule Requirements

The schedule system should support:

- Regular weekly schedules
- Block schedules
- A/B days
- Rotating schedules if feasible
- Class periods
- Section meeting times
- Date ranges
- Holidays
- No-school days
- Custom overrides
- One-off schedule changes
- Minimum days
- Testing days
- Canceled class days

## Manual Schedule Builder

Teacher should be able to:

- Add a class meeting
- Edit day, start time, end time, section, room, block
- Duplicate a schedule row
- Delete a schedule row
- Create date ranges
- Mark a day as no school
- Add a custom schedule override

## AI Schedule Parser

The AI schedule parser should accept:

- Pasted text
- Messy schedule descriptions
- OCR-style text from images
- Block schedule notes

Output must be structured JSON.

Do not save AI results immediately.

Required flow:

```txt
Paste or upload schedule
AI parses into structured rows
Teacher reviews rows
Teacher corrects errors
Teacher confirms save
Schedule entries are saved
Dashboard and Classroom update
```

## AI Schedule Parser Output Schema

Use a structured schema similar to:

```json
{
  "scheduleType": "weekly | block | rotating | unknown",
  "dateRange": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD"
  },
  "entries": [
    {
      "sectionName": "Period 1",
      "courseName": "US History",
      "dayOfWeek": "Monday",
      "startTime": "08:30",
      "endTime": "09:20",
      "room": "B203",
      "blockLabel": "A",
      "confidence": 0.92,
      "warnings": []
    }
  ],
  "holidays": [],
  "overrides": [],
  "warnings": []
}
```

## Schedule Validation

Before saving, validate:

- Start time exists
- End time exists
- End time is after start time
- Section exists or can be created
- Course exists or can be created
- Day of week is valid
- Date range is valid
- No obvious duplicate entries
- Conflicts are flagged

## Acceptance Criteria

Phase 5 is complete when:

- Manual schedule editing works reliably.
- AI-parsed schedules go through review before save.
- Schedule entries power dashboard and classroom mode.
- Holidays and overrides affect current class detection.
- Bad schedule data is flagged before saving.

---

# Phase 6: Make AI Features Practical and Structured

## Goal

Replace generic AI behavior with structured, useful, saveable workflows.

## Required AI Workflows

### 1. Parse Schedule

Covered in Phase 5.

### 2. Build Lesson Segments

Input:

- Lesson title
- Lesson objective
- Course
- Grade level if available
- Class period length
- Teacher notes
- Existing unit context

Output:

```json
{
  "segments": [
    {
      "title": "Warm-up",
      "type": "warm_up",
      "description": "Students answer the opening question...",
      "estimatedMinutes": 5,
      "teacherInstructions": "...",
      "studentInstructions": "..."
    }
  ],
  "warnings": []
}
```

Teacher must review and edit before saving.

### 3. Generate Continuity Summary

Input:

- Section
- Course
- Lesson
- Segments
- Completed segment IDs
- Current segment
- Stopped-at segment
- Carry-over notes
- Class notes
- Last taught date
- Next meeting date
- Pacing status

Output:

```json
{
  "summary": "Short teacher-facing recap.",
  "nextAction": "Start with...",
  "pacingWarning": "Optional warning.",
  "confidence": 0.88
}
```

### 4. Clean Up Notes

Input:

- Raw teacher note
- Section
- Lesson
- Desired note type

Output:

```json
{
  "cleanedNote": "Clear version of the note.",
  "suggestedType": "carry_over",
  "suggestedSaveLocation": "lesson_progress",
  "followUpAction": "Optional action"
}
```

### 5. Weekly Planning Assistant

Input:

- Teacher schedule
- Current date
- Course progress
- Section progress
- Holidays
- Remaining meetings
- Upcoming lessons

Output:

```json
{
  "weekSummary": "Short overview.",
  "priorities": [],
  "pacingWarnings": [],
  "suggestedAdjustments": [],
  "sectionsToWatch": []
}
```

## AI API Rules

All AI endpoints should:

- Return structured JSON.
- Validate output before returning to frontend.
- Include warnings when uncertain.
- Avoid long prose unless the teacher asked for it.
- Never overwrite teacher data without review.
- Save only after teacher confirmation.
- Keep model prompts grounded in existing app data.
- Fail with user-readable errors.

## Suggested API Files

```txt
api/parse-schedule.js
api/generate-lesson-segments.js
api/generate-continuity.js
api/clean-note.js
api/generate-week-plan.js
api/generate-unit-outline.js
```

## Acceptance Criteria

Phase 6 is complete when:

- AI outputs structured JSON.
- AI output can be reviewed and edited before saving.
- AI actions are named as practical teacher tasks.
- AI is integrated into Dashboard, Classroom, Schedule, Course Detail, and Lesson Tracker where useful.
- No AI feature produces unsaved generic text as the final workflow.

---

# Phase 7: Improve Curriculum and Course Detail

## Goal

Make `/curriculum` and `/courses/:id` the long-term planning workspace.

## Curriculum Page

The curriculum page should show course cards.

Each card should include:

- Course title
- Active sections
- Current unit
- Current lesson range
- Overall progress
- Last updated
- Quick actions

Actions:

```txt
Open Course
Duplicate Course
Archive Course
Create Lesson
Plan Week
```

## Course Detail Page

The course detail page should support:

- Units
- Lessons
- Segments
- Section progress
- Calendar view
- Timeline view
- Standards if already implemented
- AI lesson and unit generation

## Course Detail Layout

Recommended sections:

```txt
Course Header
Unit List
Lesson Planner
Segment Editor
Section Progress
Timeline or Calendar
AI Planning Actions
```

## Unit and Lesson Structure

A course should have:

```txt
Course
  Unit
    Lesson
      Segment
```

Teacher should be able to:

- Create units
- Edit units
- Reorder units
- Create lessons
- Edit lessons
- Reorder lessons
- Add segments
- Edit segments
- Reorder segments
- Attach standards if available
- See which sections are on which lesson

## AI Planning Actions

Use practical actions:

```txt
Create Unit Outline
Build Lessons From Unit
Break Lesson Into Segments
Clean Up Lesson Plan
Suggest Next Lesson
```

## Acceptance Criteria

Phase 7 is complete when:

- Course Detail is the clear long-term planning workspace.
- Units, lessons, and segments are visually connected.
- Teachers can edit and reorder plans.
- Teachers can see section progress within the course.
- AI-generated curriculum content saves into real structures after review.

---

# Phase 8: Build Real Pacing Intelligence

## Goal

Make pacing useful and data-driven.

## Pacing Inputs

Pacing should use:

- Term start date
- Term end date
- School holidays
- Schedule entries
- Schedule overrides
- Remaining meetings
- Planned lesson count
- Completed lesson count
- Completed segments
- Section-specific progress
- Unit target dates if available

## Pacing Labels

Use clear labels:

```txt
Ahead
On track
Slightly behind
Behind
No data
```

## Pacing Warnings

Examples:

```txt
Period 2 is two segments behind Period 4.
This course has 9 class meetings left and 6 lessons remaining.
Lesson 5 has carried over across 3 class meetings.
No lesson progress has been saved for Period 1 this week.
```

## Where Pacing Appears

Pacing should appear in:

- Dashboard
- School Overview
- Course Detail
- Lesson Tracker
- Weekly Planning Assistant

## Acceptance Criteria

Phase 8 is complete when:

- Pacing is based on real schedule and progress data.
- Pacing warnings are concise and useful.
- Pacing appears in daily and weekly planning views.
- The app does not show fake precision when data is missing.
- Missing data states are clear.

---

# Phase 9: Polish UX, Empty States, and Reliability

## Goal

Make the app feel trustworthy and coherent.

## UX Polish Requirements

### Dashboard

- Reduce visual noise.
- Make current class and next class obvious.
- Avoid large decorative empty cards.
- Show clear empty states if no schedule exists.

### Classroom

- Optimize for speed.
- Keep primary action visible.
- Make segment interactions obvious.
- Add confirmation before ending class.

### Schedule

- Make schedule rows easy to edit.
- Show validation warnings inline.
- Make AI review flow clear.

### Course Detail

- Reduce clutter.
- Make hierarchy visually obvious.
- Make AI actions specific and practical.

### Lesson Tracker

- Make saved state clear.
- Show autosave feedback if autosave exists.
- Prevent accidental overwrites.

## Empty State Requirements

Use helpful empty states.

Examples:

```txt
No schedule yet. Add your weekly schedule or paste it and let the app structure it.
No lesson progress saved for this section yet.
No class is currently in session. Your next class starts at 10:30 AM.
No carry-over notes for today.
```

## Error State Requirements

Errors should explain the problem in teacher-friendly language.

Bad:

```txt
Failed to fetch data.
```

Better:

```txt
Could not load today’s schedule. Check your connection or try again.
```

## Acceptance Criteria

Phase 9 is complete when:

- Core pages feel consistent.
- Empty states are useful.
- Errors are understandable.
- Teacher can recover from missing data.
- Main flows do not feel assembled or disconnected.

---

# Phase 10: Final QA and Build Verification

## Goal

Make sure the app is stable enough for real use.

## Required Test Scenarios

### Scenario 1: New teacher setup

1. Sign up.
2. Complete onboarding.
3. Create school.
4. Create course.
5. Create sections.
6. Add schedule.
7. Land on dashboard.

Expected result:

- Dashboard shows today’s schedule or a useful empty state.
- Teacher can navigate to schedule, curriculum, classroom, and profile.

### Scenario 2: Schedule parsing

1. Paste messy schedule text.
2. Run parser.
3. Review parsed rows.
4. Correct one row.
5. Save.
6. Return to dashboard.

Expected result:

- Schedule rows save correctly.
- Dashboard and Classroom use the saved schedule.

### Scenario 3: Classroom execution

1. Open Classroom Mode during a scheduled class.
2. Confirm detected section.
3. Mark a segment complete.
4. Add a quick note.
5. End class.
6. Save stopping point.

Expected result:

- Lesson progress updates.
- Carry-over note saves.
- Dashboard reflects new stopped-at point.

### Scenario 4: Different sections at different progress levels

1. Create one course with two sections.
2. Attach the same lesson to both sections.
3. Mark different segments complete for each section.
4. Open dashboard and course detail.

Expected result:

- Each section shows its own progress.
- App does not merge progress incorrectly.

### Scenario 5: Holiday impact

1. Add a holiday or no-school day.
2. Check dashboard and schedule.
3. Check pacing warning if enough data exists.

Expected result:

- No class appears on the holiday.
- Pacing or weekly plan accounts for the missed meeting where possible.

### Scenario 6: AI continuity

1. Complete part of a lesson.
2. Add notes.
3. Generate continuity summary.
4. Review and save.
5. Return later.

Expected result:

- Summary is short and accurate.
- Summary is tied to the section and lesson.
- Teacher can edit or regenerate it.

## Build Checks

Before finalizing each phase, run:

```bash
npm install
npm run lint
npm run build
```

If tests exist, run:

```bash
npm test
```

If the project uses a different test command, inspect `package.json` and use the correct command.

## Code Quality Rules

- Do not introduce duplicated logic when a shared service or hook should be used.
- Do not add AI output that cannot be reviewed before saving.
- Do not overwrite existing teacher data without confirmation.
- Do not make route changes unless necessary.
- Do not break existing auth or onboarding.
- Do not hardcode fake progress if real data exists.
- Do not silently ignore Supabase errors.
- Do not leave broken buttons or placeholder actions in main flows.

---

## Suggested Implementation Order for Codex

Use this exact order unless the existing codebase forces a dependency change.

```txt
1. Inspect current routes, services, hooks, Supabase schema usage, and API endpoints.
2. Identify duplicated schedule and progress logic.
3. Create or clean shared services.
4. Create or clean shared hooks.
5. Centralize schedule utilities.
6. Centralize lesson progress utilities.
7. Rebuild Dashboard around today.
8. Improve Classroom Mode.
9. Improve Lesson Tracker.
10. Strengthen Schedule Builder and AI schedule review.
11. Convert AI endpoints to structured JSON outputs where needed.
12. Improve Course Detail and curriculum hierarchy.
13. Add real pacing calculations.
14. Polish empty states and errors.
15. Run full QA scenarios and build checks.
```

---

## Codex Working Instructions

When working through this repo:

1. Start by reading the current file tree.
2. Read `package.json`.
3. Identify the current frontend structure.
4. Identify the Supabase client setup.
5. Identify all route components.
6. Identify existing API endpoints.
7. Identify current table names by reading existing Supabase queries.
8. Do not assume schema names if the code already uses different names.
9. Preserve existing user data structures where possible.
10. Add migration notes if database changes are required.
11. Prefer small, reviewable commits.
12. After each major phase, run lint and build.
13. Keep the UI practical and teacher-centered.
14. Do not add generic AI chat unless explicitly asked.
15. Make the app feel like a teacher planning sheet and classroom command center.

---

## Database Change Rules

If a needed field or table does not exist, do not hack around it in UI state.

Instead:

1. Document the required database change.
2. Create the migration if this repo uses migrations.
3. If migrations are not set up, create a clear SQL file in a `supabase` or `docs/database` folder.
4. Update service functions to use the new field.
5. Add fallback behavior for existing records.

Likely database needs:

```txt
lesson_progress.status
lesson_progress.stopped_at_segment_id
lesson_progress.current_segment_id
lesson_progress.completed_segment_ids
lesson_progress.carry_over_note
lesson_progress.last_taught_date
class_notes.note_type
class_notes.cleaned_note
schedule_overrides
ai_generated_outputs or ai_logs
teacher_preferences
```

Only add these if they do not already exist.

---

## Suggested File Additions

These are suggested files. Match the existing repo style.

```txt
src/lib/scheduleUtils.js
src/lib/lessonProgressUtils.js
src/lib/pacingUtils.js
src/lib/aiSchemas.js

src/services/scheduleService.js
src/services/lessonProgressService.js
src/services/classNotesService.js
src/services/courseService.js
src/services/sectionService.js
src/services/holidayService.js

src/hooks/useTodaySchedule.js
src/hooks/useActiveClass.js
src/hooks/useNextClass.js
src/hooks/useLessonProgress.js
src/hooks/usePacingStatus.js
src/hooks/useContinuitySummary.js

src/components/dashboard/CurrentClassCard.jsx
src/components/dashboard/NextClassCard.jsx
src/components/dashboard/TodayScheduleList.jsx
src/components/dashboard/StoppedAtNotes.jsx
src/components/dashboard/PacingWarnings.jsx
src/components/dashboard/QuickNoteBox.jsx

src/components/classroom/SegmentChecklist.jsx
src/components/classroom/EndClassPanel.jsx
src/components/classroom/ContinuityPanel.jsx

src/components/schedule/ScheduleReviewTable.jsx
src/components/schedule/ScheduleValidationWarnings.jsx

src/components/lesson/SectionProgressComparison.jsx
src/components/lesson/LessonContinuityPanel.jsx
```

---

## UI Copy Guidelines

Use direct teacher-facing language.

Good labels:

```txt
Resume class
Save stopping point
Mark segment complete
Add quick note
Generate recap
Plan next class
Parse schedule
Review and save
```

Avoid vague labels:

```txt
Use AI
Process
Continue
Submit
Generate
Optimize
```

Use short explanations.

Example:

```txt
No class is currently in session. Your next class starts at 10:30 AM.
```

Not:

```txt
There is no active instructional block detected within the current temporal range based on your configured schedule.
```

---

## Final Definition of Done

This project is successful when the teacher can:

1. Add a schedule.
2. Create courses and sections.
3. Build lessons with segments.
4. Open the dashboard and see today clearly.
5. Open Classroom Mode during class.
6. Mark what was completed.
7. Save exactly where the class stopped.
8. Return later and know where to resume.
9. See when sections are ahead or behind.
10. Use AI features without feeling like they are using a chatbot.

The app should become the operational layer between curriculum plans, real classroom progress, daily schedules, and future planning.
