let measurementSequence = 0;

export async function measureStartupPhase<T>(
  phase: 'settings' | 'workspace',
  action: () => Promise<T>,
): Promise<T> {
  const performanceApi = window.performance;
  if (!performanceApi?.mark || !performanceApi.measure) return action();

  const sequence = measurementSequence++;
  const start = `pivi:startup:${phase}:${sequence}:start`;
  const end = `pivi:startup:${phase}:${sequence}:end`;
  performanceApi.mark(start);
  try {
    return await action();
  } finally {
    performanceApi.mark(end);
    performanceApi.measure(`pivi:startup:${phase}`, start, end);
    performanceApi.clearMarks(start);
    performanceApi.clearMarks(end);
  }
}
