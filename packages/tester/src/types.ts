export interface TestStep {
  label:  string;
  passed: boolean;
  detail?: string;
  error?:  string;
  fix?:    string;
  stack?:  string;
}

export interface TestResult {
  module:     string;
  passed:     boolean;
  steps:      TestStep[];
  durationMs: number;
}
