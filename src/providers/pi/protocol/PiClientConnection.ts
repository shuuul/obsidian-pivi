import type { PiJsonRpcTransport } from "./PiJsonRpcTransport";
import type {
	PiCancelNotification,
	PiClientCapabilities,
	PiInitializeRequest,
	PiInitializeResponse,
	PiNewSessionRequest,
	PiNewSessionResponse,
	PiPromptRequest,
	PiPromptResponse,
	PiSessionNotification,
} from "./types";

type SessionNotificationListener = (
	notification: PiSessionNotification,
) => void | Promise<void>;

// Pi prompt turns are long-running RPCs; session/update notifications stream progress.
const PI_PROMPT_TURN_TIMEOUT_MS = 0;

export interface PiClientConnectionOptions {
	clientCapabilities?: Partial<PiClientCapabilities>;
	clientInfo?: { name: string; version: string } | null;
	delegate?: {
		onSessionNotification?: SessionNotificationListener;
	};
	transport: PiJsonRpcTransport;
}

/**
 * Minimal RPC client for Pi's --mode rpc protocol.
 *
 * Only exposes methods actually used by PiChatRuntime:
 * initialize, newSession, prompt, cancel.
 */
export class PiClientConnection {
	private agentInfo: PiInitializeResponse["agentInfo"] | null = null;
	private agentCapabilities: PiInitializeResponse["agentCapabilities"] | null =
		null;
	private readonly sessionNotificationListeners =
		new Set<SessionNotificationListener>();
	private readonly unsubscribeHandlers: Array<() => void> = [];

	constructor(private readonly options: PiClientConnectionOptions) {
		this.registerServerHandlers();
	}

	get signal(): AbortSignal {
		return this.options.transport.signal;
	}

	get negotiatedAgentInfo(): PiInitializeResponse["agentInfo"] | null {
		return this.agentInfo;
	}

	get negotiatedAgentCapabilities():
		| PiInitializeResponse["agentCapabilities"]
		| null {
		return this.agentCapabilities;
	}

	onSessionNotification(listener: SessionNotificationListener): () => void {
		this.sessionNotificationListeners.add(listener);
		return () => {
			this.sessionNotificationListeners.delete(listener);
		};
	}

	dispose(): void {
		while (this.unsubscribeHandlers.length > 0) {
			this.unsubscribeHandlers.pop()?.();
		}
		this.sessionNotificationListeners.clear();
	}

	async initialize(
		partialRequest: Partial<PiInitializeRequest> = {},
	): Promise<PiInitializeResponse> {
		const request: PiInitializeRequest = {
			clientCapabilities: {
				...this.options.clientCapabilities,
			},
			clientInfo: partialRequest.clientInfo ?? this.options.clientInfo ?? null,
			protocolVersion: partialRequest.protocolVersion ?? 1,
		};

		const response = await this.options.transport.request<PiInitializeResponse>(
			"initialize",
			request,
		);
		this.agentInfo = response.agentInfo ?? null;
		this.agentCapabilities = response.agentCapabilities ?? null;
		return response;
	}

	newSession(request: PiNewSessionRequest): Promise<PiNewSessionResponse> {
		return this.options.transport.request<PiNewSessionResponse>(
			"session/new",
			request,
		);
	}

	prompt(request: PiPromptRequest): Promise<PiPromptResponse> {
		return this.options.transport.request<PiPromptResponse>(
			"session/prompt",
			request,
			{
				timeoutMs: PI_PROMPT_TURN_TIMEOUT_MS,
			},
		);
	}

	cancel(notification: PiCancelNotification): void {
		this.options.transport.notify("session/cancel", notification);
	}

	private registerServerHandlers(): void {
		const transport = this.options.transport;
		const delegate = this.options.delegate;

		this.unsubscribeHandlers.push(
			transport.onNotification("session/update", async (params) =>
				this.dispatchSessionNotification(params as PiSessionNotification),
			),
		);

		// Also listen for legacy notification name for backward compatibility.
		this.unsubscribeHandlers.push(
			transport.onNotification("sessionUpdate", async (params) =>
				this.dispatchSessionNotification(params as PiSessionNotification),
			),
		);

		if (delegate?.onSessionNotification) {
			const externalHandler = delegate.onSessionNotification;
			this.unsubscribeHandlers.push(
				transport.onNotification("session/update", (params) =>
					externalHandler(params as PiSessionNotification),
				),
			);
			this.unsubscribeHandlers.push(
				transport.onNotification("sessionUpdate", (params) =>
					externalHandler(params as PiSessionNotification),
				),
			);
		}
	}

	private async dispatchSessionNotification(
		notification: PiSessionNotification,
	): Promise<void> {
		for (const listener of this.sessionNotificationListeners) {
			await listener(notification);
		}
	}
}
