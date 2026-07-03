import type { ModelAuthHost, ProviderAuthModel } from '../ports';
import { isProviderDisabled } from './ProviderSecretStorage';

export interface ResolveProviderAuthOptions<TModel extends ProviderAuthModel, TAuthResult> {
  disabledProviders?: readonly string[];
  model: TModel;
  modelAuthHost: ModelAuthHost<TModel, TAuthResult>;
}

export function resolveProviderAuth<TModel extends ProviderAuthModel, TAuthResult>({
  disabledProviders = [],
  model,
  modelAuthHost,
}: ResolveProviderAuthOptions<TModel, TAuthResult>): Promise<TAuthResult | undefined> {
  if (isProviderDisabled(disabledProviders, model.provider)) {
    return Promise.resolve(undefined);
  }

  return modelAuthHost.getAuth(model);
}
