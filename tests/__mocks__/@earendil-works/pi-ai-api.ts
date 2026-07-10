const mockApi = () => ({
  stream: () => ({
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ done: true, value: undefined }) };
    },
    result: () => Promise.resolve({ role: 'assistant', content: [] }),
  }),
  streamSimple: () => ({
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ done: true, value: undefined }) };
    },
    result: () => Promise.resolve({ role: 'assistant', content: [] }),
  }),
});

export const openAICompletionsApi = mockApi;
export const openAIResponsesApi = mockApi;
export const anthropicMessagesApi = mockApi;
