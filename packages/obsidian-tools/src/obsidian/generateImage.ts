import {
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

type InsertMode = 'none' | 'append' | 'prepend' | 'replace_string';
type OutputFormat = 'png' | 'jpeg' | 'webp';

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function getOutputFormat(value: unknown): OutputFormat {
  return value === 'jpeg' || value === 'webp' || value === 'png' ? value : 'png';
}

function getInsertMode(value: unknown): InsertMode {
  return value === 'append' || value === 'prepend' || value === 'replace_string' || value === 'none'
    ? value
    : 'none';
}

function extensionForFormat(format: OutputFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

function defaultFilename(format: OutputFormat): string {
  return `pivi-generated-${new Date().toISOString().replace(/[:.]/g, '-')}.${extensionForFormat(format)}`;
}

function base64ToArrayBuffer(data: string): ArrayBuffer {
  const binary = globalThis.atob(data);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function createGenerateImageTool(deps: ObsidianToolDeps): ToolSpec {
  const { vault, imageGenerator } = deps;
  return {
    name: TOOL_OBSIDIAN_GENERATE_IMAGE,
    label: 'Generate image',
    description:
      'Generate an image with the openai-codex provider, save it as an Obsidian attachment, and optionally insert the embed into a note. Requires ChatGPT Plus/Pro (Codex) connected in provider settings.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image generation prompt' },
        model: { type: 'string', description: 'Codex routing model, default gpt-5.5' },
        outputFormat: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Image format, default png' },
        filename: { type: 'string', description: 'Preferred attachment filename. Defaults to a timestamped Pivi filename.' },
        sourcePath: { type: 'string', description: 'Vault note path used for Obsidian attachment placement and markdown link generation' },
        insertInto: { type: 'string', description: 'Vault note path to insert the generated image embed into' },
        insertMode: { type: 'string', enum: ['none', 'append', 'prepend', 'replace_string'], description: 'How to insert the image embed into insertInto/sourcePath/current note. Default none.' },
        old_string: { type: 'string', description: 'Exact note text to replace when insertMode=replace_string' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    metadata: {
      mutatesVault: true,
      displayKind: 'write',
    },
    async execute(toolCallId, params, signal) {
      if (!imageGenerator) {
        throw new Error('Image generation is unavailable: openai-codex image generator is not configured.');
      }
      const input = params as Record<string, unknown>;
      const prompt = getStringField(input, 'prompt')?.trim();
      if (!prompt) {
        throw new Error('Invalid image generation input: prompt is required.');
      }

      const outputFormat = getOutputFormat(input.outputFormat);
      const sourcePath = getStringField(input, 'sourcePath') ?? vault.getActiveFilePath() ?? undefined;
      const insertMode = getInsertMode(input.insertMode);
      const insertPath = getStringField(input, 'insertInto') ?? sourcePath;
      const image = await imageGenerator.generateImage({
        prompt,
        model: getStringField(input, 'model'),
        outputFormat,
        sessionId: toolCallId,
        signal,
      });
      const attachment = await vault.writeAttachment({
        filename: getStringField(input, 'filename') ?? defaultFilename(outputFormat),
        sourcePath,
        data: base64ToArrayBuffer(image.data),
      });
      const embed = attachment.markdown;

      if (insertMode !== 'none') {
        if (!insertPath) {
          throw new Error('insertMode requires insertInto, sourcePath, or an active note.');
        }
        if (insertMode === 'replace_string') {
          const oldString = getStringField(input, 'old_string');
          if (!oldString) {
            throw new Error('insertMode=replace_string requires old_string.');
          }
          await vault.editNote({ path: insertPath, old_string: oldString, new_string: embed });
        } else {
          const content = insertMode === 'append' ? `\n\n${embed}\n` : `${embed}\n\n`;
          await vault.writeNote({ path: insertPath, content, mode: insertMode });
        }
      }

      const text = insertMode === 'none'
        ? `Generated image saved to ${attachment.path}\n\n${embed}`
        : `Generated image saved to ${attachment.path} and inserted into ${insertPath}\n\n${embed}`;

      return {
        content: [
          { type: 'text', text },
          { type: 'image', data: image.data, mimeType: image.mimeType },
        ],
        details: {
          path: attachment.path,
          filePath: attachment.path,
          markdown: embed,
          resourcePath: attachment.resourcePath,
          size: attachment.size,
          extension: attachment.extension,
          model: image.model,
          backendImageModel: image.backendImageModel,
          outputFormat: image.outputFormat,
          responseId: image.responseId,
          imageGenerationId: image.imageGenerationId,
          revisedPrompt: image.revisedPrompt,
          usage: image.usage,
          insertedInto: insertMode === 'none' ? undefined : insertPath,
        },
      };
    },
  };
}
