import {
  applyAssistFields as applyDomainAssistFields,
  assistCatalog as buildAssistCatalog,
  assistSystemPrompt as buildAssistSystemPrompt,
  containsVietnamese as domainContainsVietnamese,
  parseAssistReply as parseDomainAssistReply,
  parseSourceAnalysisReply as parseDomainSourceAnalysisReply,
  sourceAnalysisExtraPrompt as domainSourceAnalysisExtraPrompt,
  type AssistCatalog as DomainAssistCatalog,
  type AssistField as DomainAssistField,
  type AssistMode as DomainAssistMode,
  type AssistScope as DomainAssistScope,
  type SourceAnalysis as DomainSourceAnalysis,
  type ProjectDNA,
  type ProjectType,
} from "@arch/domain";
import { useStudio } from "../app/store";
import { call, type Requests } from "./bridge";
import { getIn } from "./path";

export type AssistMode = DomainAssistMode;
export type AssistScope = DomainAssistScope;
export type AssistCatalog = DomainAssistCatalog;
export type AssistField = DomainAssistField;
export type AssistSuggestion = ReturnType<typeof parseDomainAssistReply>;
export type SourceAnalysis = DomainSourceAnalysis;

export type AssistRequest = Requests["dna_assist"];

export async function runDnaAssist(request: AssistRequest) {
  return call("dna_assist", request);
}

export function assistCatalog(scope: AssistScope, projectType: string): AssistCatalog {
  return buildAssistCatalog(scope, projectType as ProjectType);
}

export function assistSystemPrompt(mode: AssistMode, catalog: AssistCatalog): string {
  return buildAssistSystemPrompt(mode, catalog);
}

export function parseAssistReply(raw: string, catalog: AssistCatalog): AssistSuggestion {
  return parseDomainAssistReply(raw, catalog);
}

export function parseSourceAnalysisReply(raw: string, catalog: AssistCatalog): SourceAnalysis {
  return parseDomainSourceAnalysisReply(raw, catalog);
}

export const sourceAnalysisExtraPrompt = domainSourceAnalysisExtraPrompt;

export function applyAssistFields(dna: ProjectDNA, fields: AssistField[]): ProjectDNA {
  return applyDomainAssistFields(dna, fields);
}

export const containsVietnamese = domainContainsVietnamese;

export function shouldOfferTranslation(text: string): boolean {
  return text.trim().length > 0 && !containsVietnamese(text);
}

/**
 * Writes accepted assist fields into the draft DNA. The values go through the domain
 * `applyAssistFields` first, which turns free-text replies into the schema's shapes (a
 * materials string becomes material entries, a feature string a list) and validates the
 * whole DNA; each field is then written through `editDna`, so autosave and the field errors
 * work as for a manual edit. A proposal the schema rejects writes nothing. Returns whether
 * the fields were applied.
 */
export function applyAssistToDraft(fields: AssistField[]): boolean {
  const studio = useStudio.getState();
  const ws = studio.workspace;
  if (!ws || !fields.length) return false;
  let next: ProjectDNA;
  try {
    next = applyAssistFields(ws.draftDna, fields);
  } catch {
    return false;
  }
  for (const { path } of fields) {
    const applied = path === "context.vegetation" ? "context.front.vegetation" : path;
    studio.editDna(applied, getIn(next, applied));
  }
  return true;
}
