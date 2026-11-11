import { meetingDays } from '../lib/courseSchedule.js';

export type MeetingDraft = {
  day: (typeof meetingDays)[number];
  time: string;
  endTime: string;
  room: string;
};

export const blankMeeting = (): MeetingDraft => ({
  day: 'Monday',
  time: '',
  endTime: '',
  room: ''
});

export function CourseMeetingEditor({
  meetings,
  onChange,
  disabled
}: {
  meetings: MeetingDraft[];
  onChange: (meetings: MeetingDraft[]) => void;
  disabled: boolean;
}) {
  const update = (index: number, patch: Partial<MeetingDraft>) =>
    onChange(meetings.map((meeting, i) => (i === index ? { ...meeting, ...patch } : meeting)));
  return (
    <fieldset className="course-meeting-fields" disabled={disabled}>
      <legend className="visually-hidden">Meeting times</legend>
      {meetings.map((meeting, index) => (
        <div className="course-meeting-inputs" key={index}>
          <label>
            Day
            <select
              className="input"
              value={meeting.day}
              onChange={(event) =>
                update(index, { day: event.target.value as MeetingDraft['day'] })
              }
            >
              {meetingDays.map((day) => (
                <option key={day}>{day}</option>
              ))}
            </select>
          </label>
          <label>
            Start
            <input
              className="input"
              type="time"
              value={meeting.time}
              onChange={(event) => update(index, { time: event.target.value })}
            />
          </label>
          <label>
            End
            <input
              className="input"
              type="time"
              value={meeting.endTime}
              onChange={(event) => update(index, { endTime: event.target.value })}
            />
          </label>
          <label>
            Room
            <input
              className="input"
              value={meeting.room}
              onChange={(event) => update(index, { room: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="secondary"
            aria-label={`Remove meeting ${index + 1}`}
            onClick={() => onChange(meetings.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() => onChange([...meetings, blankMeeting()])}
      >
        + Meeting
      </button>
    </fieldset>
  );
}
