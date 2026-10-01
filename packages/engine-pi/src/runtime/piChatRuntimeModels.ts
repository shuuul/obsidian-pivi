import type { Agent, ThinkingLevel } from '@earendil-works/pi-agent-core';
import { getContextCalibration } from '@pivi/agent/runtime/contextAccounting';
import { calculateReadToolMaxChars } from '@pivi/agent/runtime/usage';

import { resolvePiModel, resolvePiProviderAuth } from '../models/piModelEnv';
import type { PiResolvedModel } from '../models/piModelRegistry';
import { resolvePiThinkingLevelForModel } from '../models/piThinkingLevels';
import { refreshLocalModelMetadata } from './piChatRuntimeSupport';
import type { PiChatRuntimeProviderOverride } from './piChatRuntimeTypes';
import type { PiRuntimeHost } from './piRuntimeHost';

/**
 * Model, auth, and thinking-level resolution for one chat runtime. Reads the
 * live settings on every call; the optional provider override replaces the
 * selected model and its auth together.
 */
export class PiChatModelResolver {
  private readonly refreshedLocalModelKeys = new Set<string>();

  constructor(
    private readonly plugin: PiRuntimeHost,
    private readonly providerOverride: PiChatRuntimeProviderOverride | null,
    private readonly warn: (message: string) => void,
  ) {}

  /** Settings store models as "<provider>/<modelId>". */
  resolveModel(): PiResolvedModel | null {
    return this.providerOverride?.model ?? resolvePiModel(this.plugin);
  }

  async resolveAuth(model: PiResolvedModel) {
    if (this.providerOverride) {
      return this.providerOverride.auth;
    }
    try {
      return await resolvePiProviderAuth(this.plugin, model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn(`Failed to resolve provider auth for ${model.provider}: ${message}`);
      return undefined;
    }
  }

  resolveThinkingLevel(model: PiResolvedModel): ThinkingLevel {
    return resolvePiThinkingLevelForModel(
      model,
      typeof this.plugin.settings.thinkingLevel === 'string' ? this.plugin.settings.thinkingLevel : undefined,
    );
  }

  readMaxCharsForTools(): number {
    const model = this.resolveModel();
    const key = model ? `${model.provider}/${model.id}` : '';
    return calculateReadToolMaxChars(getContextCalibration(key));
  }

  refreshLocalMetadataAfterPrompt(agent: Agent): Promise<boolean> {
    return refreshLocalModelMetadata(agent, this.refreshedLocalModelKeys, () => this.resolveModel(), this.warn);
  }
}
