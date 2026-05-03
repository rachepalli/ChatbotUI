export type LLMUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LLMErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_BAD_RESPONSE"
  | "INTERNAL_ERROR";

export type LLMError = {
  code: LLMErrorCode;
  message: string;
  provider: string;
};

export type LLMRequest = {
  message: string;
  model: string;
  timeoutMs?: number;
};

export type LLMResponse = {
  message: string;
  model: string;
  usage: LLMUsage;
  error: LLMError | null;
};

export interface LLMProvider {
  provider: string;
  supportsModel(model: string): boolean;
  sendMessage(input: LLMRequest): Promise<LLMResponse>;
}
