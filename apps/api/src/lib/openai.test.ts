import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ParseScheduleResponseSchema } from '@teacheros/contracts';

import { buildUserContent, runStructuredPrompt } from './openai.js';

const prompt = {
  apiKey: 'test-key',
  model: 'test-model',
  schemaName: 'test_schema',
  systemPrompt: 'System prompt',
  userPrompt: 'Read this document',
  schema: z.object({})
};

describe('buildUserContent', () => {
  it('sends Word calendar documents as input files', () => {
    expect(
      buildUserContent({
        ...prompt,
        fileName: 'school-calendar.docx',
        fileDataUrl:
          'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AA=='
      })
    ).toEqual([
      {
        type: 'input_file',
        filename: 'school-calendar.docx',
        file_data:
          'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AA=='
      },
      { type: 'input_text', text: 'Read this document' }
    ]);
  });

  it('keeps image calendar uploads as input images', () => {
    expect(buildUserContent({ ...prompt, fileDataUrl: 'data:image/png;base64,AA==' })).toEqual([
      { type: 'input_text', text: 'Read this document' },
      { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'original' }
    ]);
  });

  it('rejects image formats the vision API cannot read', () => {
    expect(() =>
      buildUserContent({ ...prompt, fileDataUrl: 'data:image/heic;base64,AA==' })
    ).toThrow('Unsupported schedule image');
  });
});

describe('runStructuredPrompt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests and preserves exact schedule end times', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            classes: [
              {
                name: 'Spanish 5',
                period: 'Group B',
                days: ['Monday'],
                time: '08:10',
                endTime: '08:47',
                room: null,
                subject: 'Spanish',
                grade: '5'
              }
            ],
            assignments: []
          })
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const result = await runStructuredPrompt({
      ...prompt,
      schema: ParseScheduleResponseSchema
    });
    const request = fetchMock.mock.calls[0]?.[1];
    const requestBody = JSON.parse(String(request?.body)) as {
      text: {
        format: {
          schema: {
            properties: {
              classes: { items: { properties: Record<string, unknown> } };
            };
          };
        };
      };
    };

    expect(requestBody.text.format.schema.properties.classes.items.properties).toHaveProperty(
      'endTime'
    );
    expect(result).toMatchObject({ classes: [{ endTime: '08:47' }] });
  });
});
