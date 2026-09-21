export function generateLogId(createdAt: number): string {
  return `log-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
}
