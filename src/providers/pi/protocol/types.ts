// Pi RPC protocol types. Pi's --mode rpc uses JSON-RPC 2.0 with typed session
// notifications defined below. This is a subset of the Agent Communication
// Protocol (ACP) — only the types actually received/sent by the Pi runtime.

export type RequestId = number | string | null;
export type SessionId = string;
export type ToolCallId = string;
export type StopReason = string;
export type Role = "assistant" | "user";

export interface PiImplementation {
	name: string;
	version: string;
	title?: string | null;
}

export interface PiClientCapabilities {
	terminal?: boolean;
	positionEncodings?: PositionEncodingKind[];
}

export type PositionEncodingKind = "utf-16" | "utf-32" | "utf-8";

export interface PiInitializeRequest {
	clientCapabilities?: PiClientCapabilities;
	clientInfo?: PiImplementation | null;
	protocolVersion: number;
}

export interface PiInitializeResponse {
	agentCapabilities?: PiAgentCapabilities;
	agentInfo?: PiImplementation | null;
	protocolVersion: number;
}

export interface PiAgentCapabilities {
	loadSession?: boolean;
	positionEncoding?: PositionEncodingKind | null;
	promptCapabilities?: {
		audio?: boolean;
		embeddedContext?: boolean;
		image?: boolean;
	};
	sessionCapabilities?: {
		close?: Record<string, never> | null;
		fork?: Record<string, never> | null;
		list?: Record<string, never> | null;
		resume?: Record<string, never> | null;
	};
}

export interface PiNewSessionRequest {
	cwd: string;
	mcpServers: PiMcpServer[];
}

export interface PiNewSessionResponse {
	sessionId: SessionId;
}

export interface PiMcpServer {
	type?: "stdio";
	args: string[];
	command: string;
	name: string;
}

export interface PiTextContent {
	type: "text";
	text: string;
}

export interface PiImageContent {
	data: string;
	mimeType: string;
	type: "image";
	uri?: string | null;
}

export interface PiAudioContent {
	data: string;
	mimeType: string;
	type: "audio";
}

export interface PiResourceLink {
	description?: string | null;
	mimeType?: string | null;
	name: string;
	size?: number | null;
	title?: string | null;
	type: "resource_link";
	uri: string;
}

export interface PiEmbeddedResource {
	resource:
		| { mimeType?: string | null; text: string; uri: string }
		| { blob: string; mimeType?: string | null; uri: string };
	type: "resource";
}

export type PiContentBlock =
	| PiTextContent
	| PiImageContent
	| PiAudioContent
	| PiResourceLink
	| PiEmbeddedResource;

export interface PiPromptRequest {
	messageId?: string | null;
	prompt: PiContentBlock[];
	sessionId: SessionId;
}

export interface PiUsage {
	cachedReadTokens?: number | null;
	cachedWriteTokens?: number | null;
	inputTokens: number;
	outputTokens: number;
	thoughtTokens?: number | null;
	totalTokens: number;
}

export interface PiPromptResponse {
	stopReason: StopReason;
	usage?: PiUsage | null;
	userMessageId?: string | null;
}

export interface PiCancelNotification {
	sessionId: SessionId;
}

export interface PiContentChunk {
	content: PiContentBlock;
	messageId?: string | null;
}

export type PiToolKind =
	| "read"
	| "edit"
	| "delete"
	| "move"
	| "search"
	| "execute"
	| "think"
	| "fetch"
	| "switch_mode"
	| "other";

export type PiToolCallStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed";

export interface PiDiffToolContent {
	newText: string;
	oldText?: string | null;
	path: string;
	type: "diff";
}

export interface PiTerminalToolContent {
	terminalId: string;
	type: "terminal";
}

export interface PiWrappedContentToolContent {
	content: PiContentBlock;
	type: "content";
}

export type PiToolCallContent =
	| PiDiffToolContent
	| PiTerminalToolContent
	| PiWrappedContentToolContent;

export interface PiToolCallLocation {
	line?: number | null;
	path: string;
}

export interface PiToolCall {
	content?: PiToolCallContent[];
	kind?: PiToolKind | null;
	locations?: PiToolCallLocation[];
	rawInput?: unknown;
	rawOutput?: unknown;
	status?: PiToolCallStatus | null;
	title: string;
	toolCallId: ToolCallId;
}

export interface PiToolCallUpdate {
	content?: PiToolCallContent[] | null;
	kind?: PiToolKind | null;
	locations?: PiToolCallLocation[] | null;
	rawInput?: unknown;
	rawOutput?: unknown;
	status?: PiToolCallStatus | null;
	title?: string | null;
	toolCallId: ToolCallId;
}

export interface PiPlanEntry {
	content: string;
	priority: "high" | "medium" | "low";
	status: "pending" | "in_progress" | "completed";
}

export interface PiPlan {
	entries: PiPlanEntry[];
}

export interface PiAvailableCommandInput {
	hint: string;
}

export interface PiAvailableCommand {
	description?: string | null;
	input?: PiAvailableCommandInput | null;
	name: string;
}

export interface PiAvailableCommandsUpdate {
	availableCommands: PiAvailableCommand[];
}

export interface PiCurrentModeUpdate {
	currentModeId: string;
}

export interface PiSessionInfoUpdate {
	title?: string | null;
	updatedAt?: string | null;
}

export interface PiUsageUpdate {
	size: number;
	used: number;
}

export type PiSessionUpdate =
	| (PiContentChunk & { sessionUpdate: "user_message_chunk" })
	| (PiContentChunk & { sessionUpdate: "agent_message_chunk" })
	| (PiContentChunk & { sessionUpdate: "agent_thought_chunk" })
	| (PiToolCall & { sessionUpdate: "tool_call" })
	| (PiToolCallUpdate & { sessionUpdate: "tool_call_update" })
	| (PiPlan & { sessionUpdate: "plan" })
	| (PiAvailableCommandsUpdate & { sessionUpdate: "available_commands_update" })
	| (PiCurrentModeUpdate & { sessionUpdate: "current_mode_update" })
	| (PiSessionInfoUpdate & { sessionUpdate: "session_info_update" })
	| (PiUsageUpdate & { sessionUpdate: "usage_update" });

export interface PiSessionNotification {
	sessionId: SessionId;
	update: PiSessionUpdate;
}
