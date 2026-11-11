import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { LessonResourceDocument } from '@teacheros/contracts';

let fontBytes: Promise<Buffer> | undefined;
const ink = rgb(0.1, 0.12, 0.14);
const gray = rgb(0.4, 0.43, 0.45);
const line = rgb(0.76, 0.78, 0.8);

export function wrapPdfText(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (font.widthOfTextAtSize(current ? `${current} ${word}` : word, size) <= width) {
        current = current ? `${current} ${word}` : word;
      } else {
        if (current) lines.push(current);
        current = '';
        for (const character of word) {
          if (font.widthOfTextAtSize(current + character, size) > width && current) {
            lines.push(current);
            current = '';
          }
          current += character;
        }
      }
    }
    lines.push(current);
  }
  return lines;
}

export async function renderLessonResourcePdf(
  document: LessonResourceDocument,
  options: { kind: 'quiz' | 'worksheet'; courseName: string; answers?: boolean }
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  fontBytes ??= readFile(new URL('../assets/NotoSans-Regular.ttf', import.meta.url));
  const font = await pdf.embedFont(await fontBytes, { subset: true });
  pdf.setTitle(document.title);
  pdf.setSubject(options.answers ? 'Teacher answer key' : options.kind);
  const margin = 54;
  const width = 504;
  let page = pdf.addPage([612, 792]);
  let y = 738;
  const newPage = () => {
    page = pdf.addPage([612, 792]);
    y = 738;
    const heading = wrapPdfText(document.title, font, 9, width)[0] ?? '';
    page.drawText(heading, { x: margin, y, size: 9, font, color: gray });
    y -= 26;
  };
  const ensure = (height: number) => {
    if (y - height < 58) newPage();
  };
  const text = (value: string, size = 11, indent = 0, color = ink) => {
    for (const row of wrapPdfText(value, font, size, width - indent)) {
      ensure(size * 1.55);
      page.drawText(row, { x: margin + indent, y, size, font, color });
      y -= size * 1.55;
    }
  };
  text(options.answers ? 'ANSWER KEY' : options.kind === 'quiz' ? 'QUIZ' : 'WORKSHEET', 9, 0, gray);
  y -= 8;
  text(document.title, 20);
  if (options.courseName) {
    y -= 2;
    text(options.courseName, 10, 0, gray);
  }
  y -= 20;
  if (!options.answers) {
    text('Name: __________________________________    Date: __________________', 10);
    y -= 16;
    if (document.instructions) {
      text(document.instructions);
      y -= 10;
    }
  }
  page.drawLine({ start: { x: margin, y }, end: { x: 558, y }, thickness: 0.7, color: line });
  y -= 28;
  for (const [index, question] of document.questions.entries()) {
    const prompt = `${index + 1}. ${question.prompt}${question.points > 0 && options.kind === 'quiz' && !options.answers ? `  (${question.points} ${question.points === 1 ? 'point' : 'points'})` : ''}`;
    const height = wrapPdfText(prompt, font, 11, width).length * 17 + 30;
    ensure(Math.min(height + (question.options.length ? 42 : 36), 620));
    text(prompt);
    y -= 6;
    if (options.answers) {
      text(question.answer || 'No answer provided.', 11, 16);
      if (question.explanation) {
        y -= 4;
        text(question.explanation, 10, 16, gray);
      }
    } else {
      for (const [optionIndex, option] of question.options.entries()) {
        text(`${String.fromCharCode(65 + optionIndex)}. ${option}`, 11, 16);
        y -= 3;
      }
      for (let i = 0; i < question.answerLines; i++) {
        ensure(22);
        y -= 18;
        page.drawLine({
          start: { x: margin + 16, y },
          end: { x: 558, y },
          thickness: 0.45,
          color: line
        });
        y -= 4;
      }
    }
    y -= 22;
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    const footer = `${index + 1} / ${pages.length}`;
    item.drawText(footer, {
      x: 558 - font.widthOfTextAtSize(footer, 9),
      y: 32,
      font,
      size: 9,
      color: gray
    });
  });
  return pdf.save();
}
