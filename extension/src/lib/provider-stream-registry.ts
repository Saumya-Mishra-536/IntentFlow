export type SeqProvider = 'chatgpt' | 'claude' | 'perplexity' | 'grok';

export interface ProviderStreamConfig {
  provider: SeqProvider;
  hostPatterns: readonly string[];
  appUrl: string;
  streamPortName: string;
  mainScriptPattern: string;
  contentScriptPattern: string;
}

export const providerStreamRegistry: Record<SeqProvider, ProviderStreamConfig> = {
  chatgpt: {
    provider: 'chatgpt',
    hostPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    appUrl: 'https://chatgpt.com/',
    streamPortName: 'chatgpt-stream',
    mainScriptPattern: 'chatgptStreamMain',
    contentScriptPattern: 'chatgptStreamContent',
  },
  claude: {
    provider: 'claude',
    hostPatterns: ['https://claude.ai/*', 'https://www.claude.ai/*'],
    appUrl: 'https://claude.ai/new',
    streamPortName: 'claude-stream',
    mainScriptPattern: 'claudeStreamMain',
    contentScriptPattern: 'claudeStreamContent',
  },
  perplexity: {
    provider: 'perplexity',
    hostPatterns: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*'],
    appUrl: 'https://www.perplexity.ai/',
    streamPortName: 'perplexity-stream',
    mainScriptPattern: 'perplexityStreamMain',
    contentScriptPattern: 'perplexityStreamContent',
  },
  grok: {
    provider: 'grok',
    hostPatterns: ['https://grok.com/*', 'https://www.grok.com/*'],
    appUrl: 'https://grok.com/',
    streamPortName: 'grok-stream',
    mainScriptPattern: 'grokStreamMain',
    contentScriptPattern: 'grokStreamContent',
  },
};

export const providerStreamConfigs = Object.values(providerStreamRegistry);

export const providerByStreamPortName: ReadonlyMap<string, SeqProvider> = new Map(
  providerStreamConfigs.map((config) => [config.streamPortName, config.provider]),
);

export const streamPortNames: ReadonlySet<string> = new Set(
  providerStreamConfigs.map((config) => config.streamPortName),
);

export const STREAM_PORT_BY_PROVIDER: Record<SeqProvider, string> = {
  chatgpt: providerStreamRegistry.chatgpt.streamPortName,
  claude: providerStreamRegistry.claude.streamPortName,
  perplexity: providerStreamRegistry.perplexity.streamPortName,
  grok: providerStreamRegistry.grok.streamPortName,
};
