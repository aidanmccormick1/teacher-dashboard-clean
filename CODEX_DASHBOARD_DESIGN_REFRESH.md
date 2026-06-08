# Teacher Dashboard Design Refresh

## Summary
- Move the product toward a calm, Apple-like teaching workspace.
- Keep the useful information, but reduce visual competition.
- Prefer fewer, stronger surfaces over many equal-weight cards.
- Make the dashboard feel like a daily command center, not an admin report.
- Keep teacher-facing language simple and action-oriented.

## Current Direction
The dashboard should feel like:

- `What is happening now?`
- `What should I prepare next?`
- `What is missing from setup?`
- `Where do I go if I need to manage the plan?`

The page should not feel like:

- a database dashboard,
- a dense analytics wall,
- a paper worksheet with too many boxes,
- a collection of unrelated widgets.

## Visual Principles

### 1. Calm Hierarchy
- One dominant hero area only.
- One primary action at a time.
- Metrics should be glanceable, not heavy.
- Setup information should be visible but not shout over teaching tasks.

### 2. Apple-Like Surfaces
- Use soft translucent panels.
- Use large radii and subtle shadows.
- Avoid thick borders unless the element is interactive or urgent.
- Prefer quiet contrast over hard outlines.
- Use background depth instead of visible grid lines.

### 3. Practical Teacher Flow
The dashboard should prioritize this order:

1. Current class
2. Next class
3. Setup gaps
4. Today schedule
5. Course/year-plan health
6. Notes/checklist

If no current class exists, the empty state should stay compact so setup and next actions move higher.

### 4. Fewer Boxes
Use grouped sections instead of many individual bordered cards.

Good:
- one metric strip with four values,
- one setup rail with progress,
- one active class panel,
- one next class panel.

Avoid:
- four large metric cards with equal visual weight,
- repeated bordered empty states,
- separate cards for small helper prompts,
- large blank panels when there is no data.

## Dashboard Design Rules

### Hero
- Label: `Daily Desk`
- Purpose: orient the teacher for the day.
- Keep it compact enough that setup and class information appear without too much scrolling.
- Show readiness as a secondary status card, not as the main feature.
- Keep buttons in this priority:
  - Open or resume classroom
  - Adjust schedule
  - Copy daily brief
  - Copy setup
  - Print

### Metrics
- Use a single quiet metric strip.
- Metrics are for scanning, not analysis.
- Keep labels short:
  - classes today
  - courses
  - lessons planned
  - lesson segments

### Setup
- Use progress language, for example `2 of 6 ready`.
- Keep setup steps compact.
- Do not show a large first-time welcome card above metrics.
- Welcome can stay as a secondary action.
- Management can stay as a setup action.

### Active Class
- This should be the most important content card below setup.
- If there is no active class, use a compact empty state.
- If there is an active lesson, show:
  - course,
  - section,
  - time and room,
  - lesson title,
  - segment progress,
  - carry-over note.

### Next Class
- Keep this visible near the active class.
- Show the most useful next preparation signal:
  - starts in,
  - course and section,
  - lesson,
  - next segment,
  - carry-over.

### Timeline
- Use timeline as a daily rhythm view.
- Do not make timeline visually heavier than active/next class.
- If no classes exist, keep the empty state short.

### Notes
- Notes should feel like a focus pad, not a form.
- Keep the checklist concise.
- Future improvement: allow the teacher to pin a note to a course or period.

## Component Style Guide

### Cards
- Border radius: large, soft.
- Border: low-opacity neutral.
- Shadow: soft and diffused.
- Background: warm white or translucent white.
- Avoid strong beige fill on every card.

### Buttons
- Primary buttons should be dark navy.
- Secondary buttons should be white/translucent with light border.
- Use pill shapes for buttons.
- Button labels should be action-first.

### Typography
- Use a clean sans-serif stack.
- Keep large headings bold but not cartoonishly oversized.
- Avoid overly playful type treatment on production pages.
- Eyebrow labels should be small, uppercase, and quiet.

### Color
- Base: warm off-white.
- Ink: deep navy/charcoal.
- Accent green: readiness and completion.
- Accent amber/red: setup warnings and gaps.
- Do not overuse accent colors.

### Motion
Use small, purposeful interactions:

- hover lift on actionable cards,
- subtle button hover,
- progress bar updates,
- no flashy animations.

## Management Page Follow-Up
The same design direction should eventually apply to Management.

Management should feel like:

- a setup hub,
- a planning workspace,
- a course/year-plan manager.

It should not feel like:

- an admin panel,
- a database editor,
- a giant form page.

Recommended next Management design improvements:

1. Make the tab bar lighter and less visually dominant.
2. Use cards only where they clarify course/period relationships.
3. Make `Courses`, `Periods`, `Weekly Schedule`, and `Year Plan` feel like one connected flow.
4. Keep import tools practical and quiet.
5. Add more progressive disclosure so teachers can start simple and go deeper later.

## Future Design Ideas

### Today Impact
Add a future panel that shows how today affects the year plan:

- behind sections,
- missed class days,
- holiday impact,
- catch-up needs,
- unit spillover.

### Teacher Confidence State
Add a small confidence indicator for setup:

- `Ready to teach today`
- `Schedule needs time`
- `Year plan needs lessons`
- `No class right now`

### Better Empty States
Every empty state should answer:

- what is missing,
- why it matters,
- what button to click next.

Avoid long explanations.

### Course Health
Course health should eventually show:

- lessons planned,
- segments created,
- sections attached,
- section progress spread,
- pacing risk.

## QA Checklist
Before shipping future visual changes:

- Dashboard works at desktop width.
- Dashboard works at tablet width.
- Dashboard works at mobile width.
- No horizontal overflow.
- Important actions appear above the fold on desktop.
- Empty states do not create huge blank panels.
- Setup does not dominate the teaching workflow.
- Buttons are readable and have clear hit areas.
- Readiness score is visible but not overpowering.
- Backend offline state remains understandable.

## Implementation Notes
- Current refreshed dashboard files:
  - `apps/web/src/pages/DashboardPage.tsx`
  - `apps/web/src/styles.css`
- Keep standalone routes working:
  - `/classroom`
  - `/management`
  - `/school`
  - `/profile`
- Do not introduce a new design system package yet.
- Continue using CSS variables before adding more tooling.
