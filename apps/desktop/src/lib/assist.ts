import {
  applyAssistFields as applyDomainAssistFields,
  assistCatalog as buildAssistCatalog,
  assistSystemPrompt as buildAssistSystemPrompt,
  containsVietnamese as domainContainsVietnamese,
  parseAssistReply as parseDomainAssistReply,
  type AssistCatalog as DomainAssistCatalog,
  type AssistField as DomainAssistField,
  type AssistMode as DomainAssistMode,
  type AssistScope as DomainAssistScope,
  type ProjectDNA,
  type ProjectType,
} from "@arch/domain";
import { call, type Requests } from "./bridge";

export type AssistMode = DomainAssistMode;
export type AssistScope = DomainAssistScope;
export type AssistCatalog = DomainAssistCatalog;
export type AssistField = DomainAssistField;
export type AssistSuggestion = ReturnType<typeof parseDomainAssistReply>;

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

export function applyAssistFields(dna: ProjectDNA, fields: AssistField[]): ProjectDNA {
  return applyDomainAssistFields(dna, fields);
}

export const containsVietnamese = domainContainsVietnamese;

export function shouldOfferTranslation(text: string): boolean {
  return text.trim().length > 0 && !containsVietnamese(text);
}
