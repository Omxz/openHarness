export function createScriptedProvider({ id = "test:scripted", responses }) {
  const remaining = [...responses];

  return {
    id,
    capabilities: {
      chat: true,
      toolCalling: true,
      vision: false,
      embeddings: false,
      jsonMode: true,
      streaming: false,
      contextWindow: 8192,
    },
    async complete(request) {
      const response = remaining.shift();
      if (!response) {
        throw new Error(`Scripted provider "${id}" has no response for ${request.task.id}`);
      }
      return response;
    },
  };
}
