import type { SlashCommand, StreamChunk } from "../../../core/types";
import type {
	PiAvailableCommand,
	PiContentBlock,
	PiContentChunk,
	PiPlan,
	PiSessionUpdate,
	PiToolCall,
	PiToolCallContent,
	PiToolCallStatus,
	PiToolCallUpdate,
	PiUsageUpdate,
} from "./types";

export type PiNormalizedUpdate =
	| {
			content: PiContentBlock;
			messageId?: string | null;
			role: "assistant" | "thinking" | "user";
			streamChunks: StreamChunk[];
			type: "message_chunk";
	  }
	| {
			commands: SlashCommand[];
			type: "commands";
	  }
	| {
			currentModeId: string;
			type: "current_mode";
	  }
	| {
			plan: PiPlan;
			type: "plan";
	  }
	| {
			sessionInfo: {
				title?: string | null;
				updatedAt?: string | null;
				updatedAtMs?: number | null;
			};
			type: "session_info";
	  }
	| {
			streamChunks: StreamChunk[];
			toolCall: PiToolCall;
			toolState: PiToolCallSnapshot;
			type: "tool_call";
	  }
	| {
			streamChunks: StreamChunk[];
			toolCallUpdate: PiToolCallUpdate;
			toolState: PiToolCallSnapshot;
			type: "tool_call_update";
	  }
	| {
			type: "usage";
			usage: PiUsageUpdate;
	  };

export interface PiToolCallSnapshot {
	input: Record<string, unknown>;
	name: string;
	output: string;
	status?: PiToolCallStatus | null;
}

type MessageRole = "assistant" | "thinking" | "user";

const ANONYMOUS_MESSAGE_KEY = "\u0000anonymous";

export class PiSessionUpdateNormalizer {
	private readonly seenMessages = new Map<MessageRole, Set<string>>();
	private readonly toolCalls = new Map<string, PiToolCallSnapshot>();

	reset(): void {
		this.seenMessages.clear();
		this.toolCalls.clear();
	}

	normalize(update: PiSessionUpdate): PiNormalizedUpdate {
		switch (update.sessionUpdate) {
			case "user_message_chunk":
				return this.normalizeMessageChunk("user", update);
			case "agent_message_chunk":
				return this.normalizeMessageChunk("assistant", update);
			case "agent_thought_chunk":
				return this.normalizeMessageChunk("thinking", update);
			case "tool_call":
				return this.normalizeToolCall(update);
			case "tool_call_update":
				return this.normalizeToolCallUpdate(update);
			case "plan":
				return { plan: update, type: "plan" };
			case "available_commands_update":
				return {
					commands: update.availableCommands.map(mapPiCommandToSlashCommand),
					type: "commands",
				};
			case "current_mode_update":
				return { currentModeId: update.currentModeId, type: "current_mode" };
			case "session_info_update":
				return {
					sessionInfo: {
						...update,
						updatedAtMs: parseIsoDate(update.updatedAt),
					},
					type: "session_info",
				};
			case "usage_update":
				return { type: "usage", usage: update };
		}
	}

	private normalizeMessageChunk(
		role: MessageRole,
		update: PiContentChunk,
	): Extract<PiNormalizedUpdate, { type: "message_chunk" }> {
		const streamChunks: StreamChunk[] = [];

		if (role === "user" && this.claimMessageStart("user", update.messageId)) {
			streamChunks.push({
				content: extractPrimaryText(update.content),
				itemId: update.messageId ?? undefined,
				type: "user_message_start",
			});
		} else if (
			role === "assistant" &&
			this.claimMessageStart("assistant", update.messageId)
		) {
			streamChunks.push({
				itemId: update.messageId ?? undefined,
				type: "assistant_message_start",
			});
		}

		const text = renderPiContentBlock(update.content);
		if (text && role === "thinking") {
			streamChunks.push({ content: text, type: "thinking" });
		} else if (text && role === "assistant") {
			streamChunks.push({ content: text, type: "text" });
		}

		return {
			content: update.content,
			messageId: update.messageId ?? null,
			role,
			streamChunks,
			type: "message_chunk",
		};
	}

	private normalizeToolCall(
		toolCall: PiToolCall,
	): Extract<PiNormalizedUpdate, { type: "tool_call" }> {
		const toolState: PiToolCallSnapshot = {
			input: normalizeToolInput(toolCall.rawInput),
			name: normalizeToolName(toolCall.title, toolCall.kind),
			output: renderToolPayload(toolCall.content, toolCall.rawOutput),
			status: toolCall.status,
		};
		this.toolCalls.set(toolCall.toolCallId, toolState);

		const streamChunks: StreamChunk[] = [
			{
				id: toolCall.toolCallId,
				input: toolState.input,
				name: toolState.name,
				type: "tool_use",
			},
		];

		if (toolState.status === "completed" || toolState.status === "failed") {
			streamChunks.push({
				content: toolState.output || defaultToolResultText(toolState.status),
				id: toolCall.toolCallId,
				isError: toolState.status === "failed",
				type: "tool_result",
			});
		}

		return { streamChunks, toolCall, toolState, type: "tool_call" };
	}

	private normalizeToolCallUpdate(
		toolCallUpdate: PiToolCallUpdate,
	): Extract<PiNormalizedUpdate, { type: "tool_call_update" }> {
		const current = this.toolCalls.get(toolCallUpdate.toolCallId) ?? {
			input: {},
			name: "tool",
			output: "",
			status: null,
		};

		if (toolCallUpdate.title) {
			current.name = normalizeToolName(
				toolCallUpdate.title,
				toolCallUpdate.kind ?? null,
			);
		} else if (toolCallUpdate.kind && current.name === "tool") {
			current.name = normalizeToolName(undefined, toolCallUpdate.kind);
		}

		if (toolCallUpdate.rawInput !== undefined) {
			current.input = normalizeToolInput(toolCallUpdate.rawInput);
		}

		const nextOutput =
			renderToolPayload(
				toolCallUpdate.content ?? undefined,
				toolCallUpdate.rawOutput,
			) || current.output;
		const streamChunks: StreamChunk[] = [];

		if (
			nextOutput.length > current.output.length &&
			nextOutput.startsWith(current.output)
		) {
			streamChunks.push({
				content: nextOutput.slice(current.output.length),
				id: toolCallUpdate.toolCallId,
				type: "tool_output",
			});
		}

		current.output = nextOutput;
		if (toolCallUpdate.status !== undefined) {
			current.status = toolCallUpdate.status;
		}

		if (current.status === "completed" || current.status === "failed") {
			streamChunks.push({
				content: current.output || defaultToolResultText(current.status),
				id: toolCallUpdate.toolCallId,
				isError: current.status === "failed",
				type: "tool_result",
			});
		}

		this.toolCalls.set(toolCallUpdate.toolCallId, current);

		return {
			streamChunks,
			toolCallUpdate,
			toolState: { ...current },
			type: "tool_call_update",
		};
	}

	private claimMessageStart(
		role: "assistant" | "user",
		messageId?: string | null,
	): boolean {
		const key = messageId ?? ANONYMOUS_MESSAGE_KEY;
		let seen = this.seenMessages.get(role);
		if (!seen) {
			seen = new Set();
			this.seenMessages.set(role, seen);
		}
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	}
}

function mapPiCommandToSlashCommand(command: PiAvailableCommand): SlashCommand {
	const name = command.name.replace(/^\//, "");
	return {
		argumentHint: command.input?.hint ?? undefined,
		content: "",
		description: command.description ?? undefined,
		id: `pi:${name}`,
		name,
		source: "sdk",
	};
}

function normalizeToolName(
	title?: string | null,
	kind?: string | null,
): string {
	return title?.trim() || kind?.trim() || "tool";
}

function normalizeToolInput(rawInput: unknown): Record<string, unknown> {
	if (isPlainObject(rawInput)) {
		return rawInput;
	}
	if (rawInput === undefined) {
		return {};
	}
	return { value: rawInput };
}

function renderToolPayload(
	content: PiToolCallContent[] | null | undefined,
	rawOutput: unknown,
): string {
	if (Array.isArray(content) && content.length > 0) {
		return content
			.map(renderToolCallContent)
			.filter((text) => text.length > 0)
			.join("\n\n");
	}

	return rawOutput === undefined ? "" : formatUnknownValue(rawOutput);
}

function renderToolCallContent(content: PiToolCallContent): string {
	switch (content.type) {
		case "content":
			return renderPiContentBlock(content.content);
		case "diff":
			return `Diff: ${content.path}`;
		case "terminal":
			return `Terminal: ${content.terminalId}`;
	}
}

function defaultToolResultText(status: PiToolCallStatus): string {
	return status === "failed" ? "Tool failed" : "Tool completed";
}

function extractPrimaryText(content: PiContentBlock): string {
	if (content.type === "text") {
		return content.text;
	}
	if (content.type === "resource" && "text" in content.resource) {
		return content.resource.text;
	}
	return "";
}

export function renderPiContentBlock(content: PiContentBlock): string {
	switch (content.type) {
		case "text":
			return content.text;
		case "image":
			return content.uri
				? `[image: ${content.uri}]`
				: `[image: ${content.mimeType}]`;
		case "audio":
			return `[audio: ${content.mimeType}]`;
		case "resource_link":
			return content.title || content.name || content.uri;
		case "resource":
			return "text" in content.resource
				? content.resource.text
				: `[resource: ${content.resource.uri}]`;
	}
}

function formatUnknownValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value === null) {
		return "null";
	}
	if (value === undefined) {
		return "";
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return `${value}`;
	}
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return "[unserializable]";
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseIsoDate(value?: string | null): number | null | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === null) {
		return null;
	}
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? null : timestamp;
}
