import Anthropic from '@anthropic-ai/sdk';

export const CLASSIFY_MODEL = 'claude-haiku-5-5';
export const RECIPE_MODEL = 'claude-sonnet-5-5';

export const hasLlm = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | undefined;
export const llm = (): Anthropic => (client ??= new Anthropic());
