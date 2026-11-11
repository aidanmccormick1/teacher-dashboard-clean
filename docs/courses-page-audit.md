# Courses page audit and revamp

Date: November 10, 2026

## Findings addressed

1. Settings, activity, and collaborator management pushed units below routine administrative content. Units now lead the course detail page; class groups and sharing sit beside them on desktop. Settings and activity are collapsed.
2. Meeting days followed API order. A shared, non-mutating sorter now orders Monday through Friday, followed by A-Day and B-Day, then orders same-day meetings by start time. The course list, detail page, class picker, and meeting editor use it.
3. Every unit exposed a full slides form and lesson list. Units now start as compact rows showing title, lesson count, and slides status. Teachers expand only the unit they need.
4. Slides had repeated explanatory text and large forms. A yellow slides link opens an attached deck directly. A gray Add slides button opens the editor. Labels and presentation icons accompany the colors.
5. Repeated navigation and visible maintenance controls competed with sharing. Course names now open courses directly; Share remains prominent. Linking, duplication, and lifecycle actions sit in the existing actions menu.
6. Unit editing required three browser prompts. A single inline form now edits title, description, and order.
7. Supporting request failures silently resembled empty data. Class groups, collaborators, and activity now have explicit error and retry states.

## Design and delivery checks

- **Hard gate: PASS for the changed interface.** Browser checks found no horizontal overflow in the course list or detail page at a measured 320 CSS-pixel width; the desktop detail page also fit at 1600 CSS pixels. Verified loading, empty, error, and retry states. Demo preview content was visibly identified as demo data. No new decorative assets, claims, navigation destinations, or animation were added.
- **Purpose gate: PASS.** Yellow and gray indicate actual deck availability; their labels also distinguish Open slides from Add slides. Compact rows and disclosures reduce routine scanning. The desktop columns give curriculum and class schedules the available content width.
- **Liveliness and consistency: PASS.** Energy 1 / rhythm 1 / motion 1 follows the requested functional teaching workspace. Existing typography, navy actions, neutral surfaces, and spacing remain the visual language; yellow is reserved for attached decks.
- **Craftsmanship: PASS for the exercised flows.** Browser checks covered unit expansion, unit creation and editing, slide URL validation and saving, class group creation and editing, meeting addition/removal and invalid time ranges, settings, activity, panel retries, and menu dismissal. Enter opens the slides editor; Escape closes it and restores visible keyboard focus to the initiating slides control. Slide-status text contrast measured 7.55:1 for yellow and 7.07:1 for gray; secondary text measured 5.78:1. Status borders exceed 3:1. Web TypeScript, ESLint, build, and all 100 web tests passed. `git diff --check` passed.

## Verification limits

Browser validation used an isolated local API fixture; its mutations changed only in-memory demo data. Existing backend endpoints remain in use. Live invitation delivery, permissions, external Google Slides access, and destructive lifecycle actions were not exercised against real accounts. No deployment was performed. The build retains its existing large JavaScript chunk warning.
