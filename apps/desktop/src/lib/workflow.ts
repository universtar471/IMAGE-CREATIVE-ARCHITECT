/** Shared guided-workflow contract. Rules and schemas live in @arch/domain. */
export {
  DNA_STEP_IDS,
  DnaStepIdSchema,
  WorkflowConfirmStepRequestSchema,
  WorkflowDTOSchema,
  WorkflowGetRequestSchema,
  WorkflowReopenStepRequestSchema,
  WorkflowStepIdSchema,
  WorkflowStepStateSchema,
  WorkflowStepStatusSchema,
  WORKFLOW_STEPS,
  confirmStep,
  deriveWorkflow,
  isGenerationAllowed,
  reopenStep,
} from "@arch/domain";

export type {
  DnaStepId,
  GenerationAllowed,
  WorkflowFacts,
  WorkflowModuleId,
  WorkflowStage,
  WorkflowStageSummary,
  WorkflowStepDefinition,
  WorkflowStepId,
  WorkflowStepState,
  WorkflowView,
  WorkflowViewStatus,
  WorkflowViewStep,
} from "@arch/domain";

export type {
  WorkflowView as DerivedWorkflow,
  WorkflowViewStep as DerivedWorkflowStep,
} from "@arch/domain";
