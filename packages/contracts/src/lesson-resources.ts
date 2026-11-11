import { z } from 'zod';

export const LessonResourceKindSchema = z.enum(['quiz', 'worksheet', 'video']);
export const LessonResourceQuestionSchema = z.object({
  prompt: z.string().trim().min(1).max(2400),
  options: z.array(z.string().trim().min(1).max(600)).max(6),
  answer: z.string().max(2400),
  explanation: z.string().max(2400),
  points: z.number().int().min(0).max(100),
  answerLines: z.number().int().min(0).max(12)
});
export const LessonResourceDocumentSchema = z.object({
  title: z.string().trim().min(1).max(240),
  instructions: z.string().max(3000),
  questions: z.array(LessonResourceQuestionSchema).min(1).max(20)
});
export const HobieLessonAdditionFieldsSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().max(3000),
  durationMinutes: z.number().int().min(1).max(120),
  resourceKind: z.enum(['quiz', 'worksheet']).nullable(),
  document: LessonResourceDocumentSchema.nullable()
});
export const HobieLessonAdditionSchema = HobieLessonAdditionFieldsSchema.refine(
  (value) => Boolean(value.resourceKind) === Boolean(value.document),
  'A quiz or worksheet needs its document.'
);
export const HobieLessonAdditionApplySchema = z.object({
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  addition: HobieLessonAdditionSchema
});
export type HobieLessonAddition = z.infer<typeof HobieLessonAdditionSchema>;
export const LessonResourceVideoSchema = z.object({
  title: z.string().min(1).max(300),
  url: z.string().url().max(2000),
  source: z.string().max(200),
  description: z.string().max(1500)
});
export const LessonResourceSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  segmentId: z.string().uuid(),
  kind: LessonResourceKindSchema,
  status: z.enum(['generating', 'ready', 'failed']),
  revision: z.number().int().nonnegative(),
  document: LessonResourceDocumentSchema.nullable(),
  video: LessonResourceVideoSchema.nullable(),
  error: z.string().nullable(),
  updatedAt: z.string()
});
export const PublicResourceDocumentSchema = LessonResourceDocumentSchema.extend({
  questions: z.array(LessonResourceQuestionSchema.omit({ answer: true, explanation: true }))
});
export const PublicLessonResourceSchema = LessonResourceSchema.omit({
  document: true,
  error: true
}).extend({
  document: PublicResourceDocumentSchema.nullable()
});
export const LessonResourceGenerateSchema = z.object({
  segmentId: z.string().uuid(),
  kind: LessonResourceKindSchema,
  instruction: z.string().trim().max(1000).default('')
});
export const LessonResourceUpdateSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  document: LessonResourceDocumentSchema
});
export const LessonResourceReviseSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  questionIndex: z.number().int().min(0).max(19),
  instruction: z.string().trim().min(3).max(1000)
});
export type LessonResource = z.infer<typeof LessonResourceSchema>;
export type LessonResourceKind = z.infer<typeof LessonResourceKindSchema>;
export type LessonResourceDocument = z.infer<typeof LessonResourceDocumentSchema>;
export type LessonResourceQuestion = z.infer<typeof LessonResourceQuestionSchema>;
export type PublicLessonResource = z.infer<typeof PublicLessonResourceSchema>;
