export function getTodayDateString(): string {
  const d = new Date();
  return formatDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function getPastDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatJsonPayload(data: unknown): string {
  if (data === undefined) return '(无入参)';
  if (data === null) return 'null';
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return data;
    }
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
