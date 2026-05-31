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
};

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
    typeof payload.output_text === 'string'
  ) {
    return payload.output_text;
  }

  if (payload && typeof payload === 'object' && 'output' in payload && Array.isArray(payload.output)) {
    const firstOutput = payload.output[0];
    if (firstOutput && typeof firstOutput === 'object' && 'content' in firstOutput) {
      const content = firstOutput.content;
      if (Array.isArray(content)) {
        const textPart = content.find(
          (part) => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string'
        );
        if (textPart && typeof textPart === 'object' && 'text' in textPart) {
          return textPart.text as string;
        }
      }
    }
  }

  throw new Error('Could not extract output text from OpenAI response');
}

export async function runStructuredPrompt<T>(params: PromptInput): Promise<T> {
  const schemaJson = normalizeStrictSchema(
    zodToJsonSchema(params.schema, { $refStrategy: 'none' })
  );
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
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
          }
        })
      });

      if (!response.ok) {
        throw new Error(await openAiErrorMessage(response));
      }

      const payload = (await response.json()) as unknown;
      const outputText = extractOutputText(payload);
      const parsedOutput = JSON.parse(outputText) as unknown;

      return params.schema.parse(parsedOutput) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI structured request failed');
}
