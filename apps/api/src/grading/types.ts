import type {
  ClassifierObservation,
  OpenResponsePrompt,
  OpenResponseRubric,
} from "@pa/contracts";

export interface GradingInput {
  responseText: string;
  prompt: OpenResponsePrompt;
  rubric: OpenResponseRubric;
  sourceTexts: Readonly<Record<string, string>>;
  itemId: string;
  itemVersion: string;
  allowedEvidenceIds: readonly string[];
  requestHash: string;
}

export interface GradingProvider {
  classify(input: GradingInput, signal: AbortSignal): Promise<unknown>;
}

export interface GradingResult {
  observation: ClassifierObservation;
  providerCalled: boolean;
}

export class RetryableProviderError extends Error {
  constructor(readonly status: number, message = "retryable provider error") {
    super(message);
  }
}

