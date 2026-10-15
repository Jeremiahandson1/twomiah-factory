// "Today" for schedule highlighting, as the office's own calendar day (the browser's zone — the
// screens are used from the agency).
export function getTodayCT(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getTodayDateCT(): Date {
  return new Date(getTodayCT() + 'T00:00:00');
}
