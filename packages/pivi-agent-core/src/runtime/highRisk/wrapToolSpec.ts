/**
 * Wrap a ToolSpec so high-risk operations require turn-scoped authorization.
 */

import type { ToolSpec } from '../../tools/toolSpec';
import type { HighRiskApprovalController } from './approvalController';
import {
  classifyHighRiskToolCall,
  type HighRiskClassificationContext,
} from './classify';
import { HighRiskDeniedError } from './types';

export interface WrapHighRiskToolOptions {
  controller: HighRiskApprovalController;
  classificationContext?: HighRiskClassificationContext;
}

export function wrapToolSpecWithHighRiskGate(
  spec: ToolSpec,
  options: WrapHighRiskToolOptions,
): ToolSpec {
  const { controller, classificationContext } = options;
  return {
    ...spec,
    async execute(id, params, signal) {
      const classification = await classifyHighRiskToolCall(
        spec.name,
        params,
        classificationContext,
      );
      if (!classification) {
        return spec.execute(id, params, signal);
      }

      try {
        await controller.requireAuthorized({
          kind: classification.kind,
          resources: classification.resources,
          toolName: spec.name,
        });
      } catch (error) {
        if (error instanceof HighRiskDeniedError) {
          controller.recordExecution(
            {
              kind: classification.kind,
              resources: classification.resources,
              toolName: spec.name,
            },
            'skipped',
          );
        }
        throw error;
      }

      try {
        const result = await spec.execute(id, params, signal);
        controller.recordExecution(
          {
            kind: classification.kind,
            resources: classification.resources,
            toolName: spec.name,
          },
          'completed',
        );
        return result;
      } catch (error) {
        controller.recordExecution(
          {
            kind: classification.kind,
            resources: classification.resources,
            toolName: spec.name,
          },
          'failed',
        );
        throw error;
      }
    },
  };
}

export function wrapToolSpecsWithHighRiskGate(
  specs: readonly ToolSpec[],
  options: WrapHighRiskToolOptions,
): ToolSpec[] {
  return specs.map((spec) => wrapToolSpecWithHighRiskGate(spec, options));
}
