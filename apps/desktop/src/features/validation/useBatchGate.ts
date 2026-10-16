import { useState } from "react";
import type { BatchCreateRequest, ConflictCode } from "@arch/domain";
import { useStudio } from "../../app/store";
import { gateBatch, type BatchGate } from "./gate";

/**
 * Preview of the per-item conflict gate for a batch surface (ADR-034), with the WARN codes the
 * user accepted there ("Duyệt ngoại lệ"). Checks the saved DNA, as the store does on submit;
 * pass `approvedExceptions` to `createBatch` so the real gate accepts the same codes.
 */
export function useBatchGate(request: BatchCreateRequest | null): {
  gate: BatchGate | null;
  approvedExceptions: ConflictCode[];
  approve: (codes: readonly ConflictCode[]) => void;
} {
  const dna = useStudio((s) => s.workspace!.persistedDna);
  const projectType = useStudio((s) => s.workspace!.project.projectType);
  const [approvedExceptions, setApproved] = useState<ConflictCode[]>([]);
  const gate = request ? gateBatch(request, dna, projectType, approvedExceptions) : null;
  const approve = (codes: readonly ConflictCode[]) =>
    setApproved((list) => [...new Set([...list, ...codes])]);
  return { gate, approvedExceptions, approve };
}
