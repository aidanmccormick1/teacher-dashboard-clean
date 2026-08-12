import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

type PromptInput = {
  apiKey: string;
  model: string;
  schemaName: string;
  schema: z.ZodTypeAny;
  systemPrompt: string;
  userPrompt: string;
  fileDataUrl?: string;
  fileName?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

const openAiRequestTimeoutMs = 75_000;

const unsupportedStrictSchemaKeywords = new Set([
  '$schema',
  'default',
  'format',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'multipleOf',
  'pattern'
]);

function normalizeStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStrictSchema);
  if (!value || typeof value !== 'object') return value;

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !unsupportedStrictSchemaKeywords.has(key))
      .map(([key, child]) => [key, normalizeStrictSchema(child)])
  );

  if (
    normalized.type === 'object' &&
    normalized.properties &&
    typeof normalized.properties === 'object'
  ) {
    normalized.required = Object.keys(normalized.properties);
  }

  return normalized;
}

async function openAiErrorMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string; type?: string };
  } | null;
  const apiError = payload?.error;
  const code = apiError?.code ?? apiError?.type;
  const detail = apiError?.message;
  return ['OpenAI request failed', `status ${response.status}`, code, detail]
    .filter(Boolean)
    .join(': ');
}

function buildUserContent(params: PromptInput) {
  if (!params.fileDataUrl) return params.userPrompt;

  if (params.fileDataUrl.startsWith('data:application/pdf')) {
    return [
      {
        type: 'input_file',
        filename: params.fileName ?? 'schedule.pdf',
        file_data: params.fileDataUrl
      },
      {
        type: 'input_text',
        text: params.userPrompt
      }
    ];
  }

  return [
    {
      type: 'input_text',
      text: params.userPrompt
    },
    {
      type: 'input_image',
      image_url: params.fileDataUrl,
      detail: 'high'
    }
  ];
}

function extractOutputText(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'output_text' in payload &&
    typeof payload.output_text === 'string' &&
    payload.output_text.trim().length > 0
  ) {
    return payload.output_text;
  }

  if (payload && typeof payload === 'object' && 'output' in payload && Array.isArray(payload.output)) {
    for (const output of payload.output) {
      if (output && typeof output === 'object' && 'content' in output) {
        const content = output.content;
        if (Array.isArray(content)) {
          const textPart = content.find(
            (part): part is { type?: unknown; text: string } =>
              Boolean(part) &&
              typeof part === 'object' &&
              'text' in part &&
              typeof part.text === 'string' &&
              part.text.trim().length > 0 &&
              (part.type === undefined || part.type === 'output_text')
          );
          if (textPart) return textPart.text;
        }
      }
    }
  }

  const response = payload as {
    status?: unknown;
    incomplete_details?: { reason?: unknown } | null;
    output?: Array<{ type?: string; content?: Array<{ type?: string }> }>;
  };
  const outputTypes = Array.isArray(response?.output)
    ? response.output
        .flatMap((item) => item.content?.map((content) => `${item.type ?? 'unknown'}/${content.type ?? 'unknown'}`) ?? [])
        .join(', ')
    : 'none';
  const status = typeof response?.status === 'string' ? response.status : 'unknown';
  const incompleteReason =
    typeof response?.incomplete_details?.reason === 'string' ? response.incomplete_details.reason : 'none';
  throw new Error(
    `OpenAI returned no structured schedule result (status: ${status}; incomplete: ${incompleteReason}; output: ${outputTypes || 'none'})`
  );
}

function normalizeScheduleTimes(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { classes?: unknown }).classes)) return value;

  const normalizeTime = (time: unknown): unknown => {
    if (time === null || time === undefined) return null;
    if (typeof time !== 'string') return null;
    const match = time.trim().match(/(\d{1,2})[:.](\d{2})(?:\s*([AaPp][Mm]))?/);
    if (!match?.[1] || !match[2]) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    const suffix = match[3]?.toLowerCase();
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  };

  return {
    ...(value as Record<string, unknown>),
    classes: (value as { classes: unknown[] }).classes.map((item) =>
      item && typeof item === 'object'
        ? { ...(item as Record<string, unknown>), time: normalizeTime((item as { time?: unknown }).time) }
        : item
    )
  };
}

export async function runStructuredPrompt<T>(params: PromptInput): Promise<T> {
  const schemaJson = normalizeStrictSchema(
    zodToJsonSchema(params.schema, { $refStrategy: 'none' })
  );
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), openAiRequestTimeoutMs);
      let response: Response;

      try {
        response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: params.model,
            input: [
              { role: 'system', content: params.systemPrompt },
              { role: 'user', content: buildUserContent(params) }
            ],
            text: {
              format: {
                type: 'json_schema',
                name: params.schemaName,
                strict: true,
                schema: schemaJson
              }
            },
            ...(params.reasoningEffort ? { reasoning: { effort: params.reasoningEffort } } : {})
          }),
          signal: controller.signal
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error('The AI schedule reader timed out after 75 seconds. Please try again.');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(await openAiErrorMessage(response));
      }

      const payload = (await response.json()) as unknown;
      const outputText = extractOutputText(payload);
      const parsedOutput = JSON.parse(outputText) as unknown;

      return params.schema.parse(normalizeScheduleTimes(parsedOutput)) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI structured request failed');
}
