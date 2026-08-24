import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildUserContent } from './openai.js';

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
      { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'high' }
    ]);
  });
});
