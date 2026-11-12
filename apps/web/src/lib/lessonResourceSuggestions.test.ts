import { describe, expect, it } from 'vitest';
import { suggestedResourceKind } from './lessonResourceSuggestions.js';

describe('lesson resource suggestions', () => {
  it.each([
    [
      'Partner speaking',
      'Students ask each other questions and practise conversation.',
      'Activity',
      null
    ],
    ['Speaking assessment', 'Assess how fluently students can respond aloud.', 'Assessment', null],
    ['Oral quiz', 'Students answer aloud with their partners.', 'Assessment', null],
    ['Group discussion', 'Explain your reasoning to a partner.', 'Discussion', null],
    ['Guided practice', 'Practise the new concept together.', 'Practice', null],
    ['Teacher explanation', 'Introduce the topic and demonstrate the skill.', 'Instruction', null],
    ['End-of-lesson quiz', 'Students complete a short quiz.', 'Assessment', 'quiz'],
    ['Written quiz', 'Students answer in writing.', 'Assessment', 'quiz'],
    [
      'Independent work',
      '<p>Students fill in a worksheet about food chains.</p>',
      'Practice',
      'worksheet'
    ],
    [
      'Partner speaking',
      'Use a worksheet to record the interview answers.',
      'Activity',
      'worksheet'
    ],
    ['Worksheet practice', 'Complete the handout.', 'Practice', 'worksheet'],
    ['Listen and watch', 'Watch a short video about energy.', 'Instruction', 'video'],
    ['Speaking practice', 'No worksheet is needed.', 'Activity', null],
    ['Class demonstration', 'Explain the process without a video.', 'Instruction', null],
    ['Discuss yesterday’s quiz', 'Review the answers together.', 'Discussion', null],
    [
      'Video discussion',
      'Discuss the ideas from the video students watched earlier.',
      'Discussion',
      null
    ],
    ['Video reflection', 'Write a reflection on yesterday’s video.', 'Reflection', null],
    ['After the video', 'Groups compare their notes and explain the main idea.', 'Activity', null],
    [
      'Watch and discuss',
      'Watch a short video, then discuss the main idea in groups.',
      'Activity',
      'video'
    ],
    ['Group work', 'Groups design a poster and present their ideas.', 'Instruction', null],
    ['Group task', 'Students watch a short video and compare predictions.', 'Activity', 'video'],
    ['Group quiz', 'Teams complete a written quiz together.', 'Activity', 'quiz'],
    [
      'Group investigation',
      'Groups complete a worksheet to record their observations.',
      'Activity',
      'worksheet'
    ],
    ['Video project', 'Students record a video explaining their investigation.', 'Activity', null],
    ['Create a video', 'Groups film a two-minute explanation.', 'Activity', null],
    ['Peer feedback', 'Watch the videos from last week and give feedback.', 'Activity', null],
    ['Video recap', 'Watch the same video again to check your notes.', 'Reflection', null],
    ['Video call', 'Students interview a guest over a video call.', 'Activity', null],
    [
      'Class introduction',
      'Do not show a video; demonstrate the process with real objects.',
      'Instruction',
      null
    ],
    ['Optional video', 'If time allows, watch a short video.', 'Extension', null],
    ['Extension', 'Students could watch a video if needed.', 'Activity', null],
    [
      'Watch the linked video',
      '<p>Watch <a href="https://www.youtube.com/watch?v=abcdefghijk">this video</a>.</p>',
      'Instruction',
      null
    ],
    [
      'Video: food chains',
      'Identify the producer and consumers while watching.',
      'Instruction',
      'video'
    ],
    ['Watch a clip', 'Identify how the characters respond.', 'Instruction', 'video'],
    ['Explore energy', 'Watch an animation of energy transfer.', 'Instruction', 'video'],
    [
      'Review last lesson',
      'Watch a short video about the ideas from the previous lesson.',
      'Instruction',
      'video'
    ],
    ['Quiz preparation', 'Revise the main ideas for tomorrow’s quiz.', 'Practice', null],
    [
      'Quiz review',
      'Discuss the answers to the quiz they completed yesterday.',
      'Reflection',
      null
    ],
    ['Quiz review', 'Complete a new quiz to check understanding.', 'Assessment', 'quiz'],
    ['Homework check', 'Compare answers on the worksheet from last class.', 'Practice', null],
    ['Independent practice', 'Complete the attached worksheet.', 'Practice', null],
    ['Worksheet', 'A worksheet is not required; students discuss in pairs.', 'Activity', null],
    ['Video discussion', 'First watch a short video, then share ideas.', 'Discussion', 'video'],
    [
      'Workshop',
      '<p>Watch a short video.</p><p>Then practise with a partner.</p>',
      'Practice',
      'video'
    ],
    ['Quiz', 'An oral quiz with no written responses.', 'Assessment', null]
  ] as const)('%s suggests only a relevant resource', (title, description, stepType, expected) => {
    expect(suggestedResourceKind({ title, description, stepType })).toBe(expected);
  });
});
