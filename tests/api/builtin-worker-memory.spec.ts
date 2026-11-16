import { test, expect } from '@playwright/test';
import { rssMb } from '../../api/src/services/builtinWorker';

// The built-in demo worker's memory cap reads VmRSS from /proc/<pid>/status.
test('rssMb reads VmRSS in MB', () => {
  expect(rssMb('Name:\tat-worker\nVmPeak:\t9 kB\nVmRSS:\t   8388608 kB\nThreads:\t12\n')).toBe(8192);
  expect(rssMb('Name:\tat-worker\nState:\tZ (zombie)\n')).toBeNull();
});
