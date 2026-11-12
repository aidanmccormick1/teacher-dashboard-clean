import type { LessonResourceKind } from '@teacheros/contracts';

type StepContext = { title: string; description: string | null; stepType?: string | null };

export function suggestedResourceKind(step: StepContext): LessonResourceKind | null {
  const plain = (value: string) =>
    value
      .replace(/<\/(?:p|div|li)>|<br\s*\/?>/gi, '. ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  const title = plain(step.title);
  const description = plain(step.description ?? '');
  const text = `${title}. ${description}`;
  const clauses = text.split(/[.!?;]+/);
  const review =
    /\b(?:discuss(?:ion|ing)?|reflect(?:ion|ing)?|debrief|recap|review|analysis|analy[sz]e|summari[sz]e|go over|graded|returned|prep(?:aration)?|prepare for|study for)\b/;
  const optional =
    /\b(?:optional|if (?:time|needed|available)|could|might|may (?:watch|use|show))\b/;
  const nouns = {
    quiz: 'quiz(?:zes)?',
    worksheet: '(?:worksheets?|handouts?|activity sheets?|practice sheets?)',
    video: '(?:videos?|clips?|animations?)'
  };
  const actions = {
    quiz: 'complete|take|write|answer|administer|give|do|use|create|generate|finish with|check understanding with',
    worksheet:
      'complete|fill(?: out| in)?|use|distribute|hand out|work through|create|generate|solve|answer',
    video: 'watch|view|play|show|find|search for'
  };
  const videoProduction =
    /\b(?:record|film|produce|make|edit|create|shoot|upload|present|share)\b[^.!?;]{0,80}\b(?:video|clip|animation)\b/;
  const negated = (value: string, noun: string) =>
    new RegExp(
      `\\b(?:no|without|skip|avoid|do not|don't|not(?: using)?|isn't|aren't|no need (?:for|to))\\s+(?:[\\w-]+\\s+){0,4}${noun}\\b|\\b${noun}\\s+(?:is |are )?(?:not needed|not required|isn't needed|isn't required|aren't needed|aren't required)\\b`
    ).test(value);
  const alreadyAvailable = (value: string, noun: string) =>
    new RegExp(
      `\\b(?:yesterday(?:['’]s)?|previous|earlier|attached|uploaded|provided|pre[- ]made|existing)\\s+(?:[\\w-]+\\s+){0,2}${noun}\\b|\\b${noun}\\s+(?:(?:that|which|they|we|students|was|were|is|are|have|had|has|you|the|class)\\s+){0,4}(?:already|previously|watched|completed|provided|attached|uploaded|from (?:yesterday|last|earlier|previous))\\b|\\b(?:already|previously)\\s+(?:[\\w-]+\\s+){0,3}${noun}\\b|\\b${noun}\\b[^.!?;]{0,30}\\bagain\\b`
    ).test(value);

  const needs = (kind: LessonResourceKind) => {
    const noun = nouns[kind];
    const mentions = new RegExp(`\\b${noun}\\b`);
    if (optional.test(title)) return false;
    if (kind === 'video') {
      if (
        /https?:\/\/(?:www\.)?(?:youtu\.be|youtube\.com|vimeo\.com|khanacademy\.org|pbslearningmedia\.org|ted\.com|bbc\.co\.uk)\//i.test(
          `${step.title} ${step.description ?? ''}`
        )
      )
        return false;
      if (/\b(?:video call|video conferenc\w*|rewatch|re-watch)\b/.test(text)) return false;
    }
    const eligible = (clause: string) =>
      mentions.test(clause) &&
      !negated(clause, noun) &&
      !optional.test(clause) &&
      !alreadyAvailable(clause, noun) &&
      !(kind === 'video' && videoProduction.test(clause));
    const action = new RegExp(`\\b(?:${actions[kind]})\\b[^.!?;]{0,90}\\b${noun}\\b`);
    if (clauses.some((clause) => eligible(clause) && action.test(clause))) return true;
    // A resource named as the activity is useful; a reference to past work is not a new task.
    return (
      eligible(title) &&
      !review.test(title) &&
      !/^(?:after|following)\b/.test(title) &&
      !clauses.some((clause) => mentions.test(clause) && !eligible(clause))
    );
  };

  const oral = /\b(?:oral|speaking|spoken|verbally|aloud)\b/.test(text);
  const written =
    /\b(?:written|on paper|in writing|multiple.choice|short.answer)\b/.test(text) &&
    !negated(text, '(?:written|on paper|in writing|multiple.choice|short.answer)');
  if ((!oral || written) && needs('quiz')) return 'quiz';
  if (needs('worksheet')) return 'worksheet';
  if (needs('video')) return 'video';
  return null;
}
