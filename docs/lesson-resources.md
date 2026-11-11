# Lesson resources

On an existing lesson, Hobie defaults to **Add to lesson**. Requests such as “add a single quiz” produce one proposed step and its editable quiz, using the saved lesson as context. Applying it inserts that step and resource together, without updating the existing lesson fields, steps, or resources. Repeated apply requests reuse the same step, including after a lost response. Full lesson drafting is available through the explicit **Plan lesson** choice; clear quiz/worksheet addition requests stay scoped even there.

Each lesson step suggests a quiz, worksheet, or video action. Assessment and review steps suggest a quiz, practice suggests a worksheet, and instruction suggests a video. Teachers can choose another resource type and optionally enter preferences before creating it. The saved lesson's course, grade, subject, objective, and step content supply context.

Quizzes and worksheets open in an editor with editable titles, instructions, questions, choices, response space, and grading points. Answers and explanations live in the separate teacher key. Save, Done, and Download PDF preserve edits. A teacher can ask Hobie to rewrite one question without sending the other questions back to the model.

## Storage and downloads

Migration `0032_lesson_resources.sql` adds a resource table. Each `(lesson, step, resource type)` has one stable record. Generation reserves that slot before contacting OpenAI, including across separate API processes. Repeated clicks return the saved record or its pending status. Failed requests can retry; abandoned reservations can be reclaimed after two minutes. Completed resources open instead of generating again.

Document JSON is the editable source. PDFs are rendered from the current saved revision, with an embedded Noto Sans font, academic heading, name/date lines, numbered questions, response space, and pagination. Downloading or editing manually uses no model tokens. The font and its OFL license are bundled in `apps/api/assets`. No external file storage is needed for these PDFs.

Resources appear beside their step and in Resources. Documents also appear under Materials. Sharing a lesson or curriculum reads those same saved records, so a newly downloaded PDF reflects the teacher's latest saved changes. Shared lesson pages refresh on returning to the tab. Public PDF routes validate the active sharing token on every request and never include answers. Disabling sharing revokes those downloads. Imported public copies have their own resources and step associations, without the source teacher's answer key. Private lesson/course copies retain their resources and keys.

## OpenAI configuration

The implementation uses the existing backend `OPENAI_API_KEY`. No new key is created or exposed to the browser.

- `OPENAI_MODEL_GENERATE_SEGMENTS` also generates documents and revises individual questions.
- `OPENAI_MODEL_FIND_VIDEO` defaults to `gpt-5-mini` and must support Responses API web search and structured outputs.

Video lookup requires the web search tool and checks the chosen URL against returned source URLs. Results are limited to supported educational video hosts and direct video paths. YouTube results also need a successful oEmbed availability check. A failed or ungrounded search produces a retryable error, rather than saving a guessed URL.

The search request follows the official [OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search) and uses its returned source list for URL validation.

## Verification

The database integration suite uses a disposable Postgres database and mocked OpenAI responses. It covers concurrency, persistence, direct edits, optimistic revisions, one-question rewrites, private/public PDFs, sharing revocation, copied resources, answer-key privacy, and rejected unsourced video URLs. Existing curriculum tests and web tests also run.

The browser walkthrough uses the real UI and API against the disposable database, with only the upstream AI/search responses mocked. It covers quiz and worksheet generation, direct edits, downloads, single-question rewriting, opening videos, reopening saved resources, mobile layout, Escape, and public downloads without sign-in. Student and teacher PDFs are rendered and visually inspected before delivery. Live OpenAI calls require the configured deployment key; verification does not spend that key's tokens.
