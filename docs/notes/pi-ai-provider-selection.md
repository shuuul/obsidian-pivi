# pi-ai provider selection

> Date: 2026-06-23  
> Status: selected and implemented

`@earendil-works/pi-ai@0.80.x` replaced the old global provider registry with explicit `Models` collections. Obsius now registers only the selected provider factories in `src/pi/piAiModels.ts` instead of importing every built-in provider through `builtinModels()`.

The selected providers are: `anthropic`, `deepseek`, `google`, `openai-codex`, `opencode-go`, and `openrouter`.

## Current built-in providers

Provider decision table:

| Keep? | Provider id | Notes |
|-------|-------------|-------|
| No | `amazon-bedrock` | Amazon Bedrock. |
| No | `ant-ling` | Ant Ling. |
| Yes | `anthropic` | Anthropic Claude API. |
| No | `azure-openai-responses` | Azure OpenAI Responses API. |
| No | `cerebras` | Cerebras. |
| No | `cloudflare-ai-gateway` | Cloudflare AI Gateway. |
| No | `cloudflare-workers-ai` | Cloudflare Workers AI. |
| Yes | `deepseek` | DeepSeek. |
| No | `fireworks` | Fireworks AI. |
| No | `github-copilot` | GitHub Copilot OAuth-backed provider. |
| Yes | `google` | Google Gemini API. |
| No | `google-vertex` | Google Vertex AI. |
| No | `groq` | Groq. |
| No | `huggingface` | Hugging Face. |
| No | `kimi-coding` | Kimi for Coding. |
| No | `minimax` | MiniMax global endpoint. |
| No | `minimax-cn` | MiniMax China endpoint. |
| No | `mistral` | Mistral. |
| No | `moonshotai` | Moonshot AI global endpoint. |
| No | `moonshotai-cn` | Moonshot AI China endpoint. |
| No | `nvidia` | NVIDIA NIM. |
| No | `openai` | OpenAI API. |
| Yes | `openai-codex` | OpenAI Codex subscription/OAuth provider. |
| No | `opencode` | OpenCode Zen. |
| Yes | `opencode-go` | OpenCode Go. |
| Yes | `openrouter` | OpenRouter. |
| No | `together` | Together AI. |
| No | `vercel-ai-gateway` | Vercel AI Gateway. |
| No | `xai` | xAI. |
| No | `xiaomi` | Xiaomi MiMo API billing endpoint. |
| No | `xiaomi-token-plan-ams` | Xiaomi MiMo token plan, Amsterdam. |
| No | `xiaomi-token-plan-cn` | Xiaomi MiMo token plan, China. |
| No | `xiaomi-token-plan-sgp` | Xiaomi MiMo token plan, Singapore. |
| No | `zai` | ZAI Coding Plan global endpoint. |
| No | `zai-coding-cn` | ZAI Coding Plan China endpoint. |

## Implementation

```ts
import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';

export const piAiModels = createModels();
piAiModels.setProvider(anthropicProvider());
piAiModels.setProvider(deepseekProvider());
piAiModels.setProvider(googleProvider());
piAiModels.setProvider(openaiCodexProvider());
piAiModels.setProvider(opencodeGoProvider());
piAiModels.setProvider(openrouterProvider());
```

## Caveats

- Removing a provider removes it from Obsius provider settings and model selection.
- Existing user settings that reference a removed provider/model will need fallback handling or migration.
- Some providers share API implementations, so bundle-size savings depend on which SDK/API implementations remain reachable.
- Re-run `npm run analyze:bundle` after pruning to verify actual size change.
