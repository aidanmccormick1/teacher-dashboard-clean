const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Meeting rows define section occurrences directly. There is deliberately no
// course-level rotation or alternation calculation here.
export function meetingOccursOn(day: string, date: Date): boolean {
  return weekday[date.getUTCDay()] === day;
}
