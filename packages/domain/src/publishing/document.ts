/**
 * Stored publication (SRS P5b, ADR-038 storage): what the `publications.json` column holds
 * and the bridge DTOs of the `publication_*` commands.
 *
 * A document is the planned `Publication` plus the project facts its captions may cite
 * (the user declares them in the Publishing Studio; there is no project-wide fact store yet).
 * The Rust backend validates the document against the JSON Schema exported from
 * `PublicationDocumentSchema` before it reaches SQLite.
 */
import { z } from "zod";

import {
  PaperSizeSchema,
  PublicationFactSchema,
  PublicationSchema,
  PublicationTypeSchema,
} from "./schemas";

export const PublicationDocumentSchema = z.object({
  publication: PublicationSchema,
  facts: z.array(PublicationFactSchema).default([]),
});
export type PublicationDocument = z.infer<typeof PublicationDocumentSchema>;

/** `publication_get` / `publication_save`. */
export const PublicationRecordDTOSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  publication: PublicationSchema,
  facts: z.array(PublicationFactSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicationRecordDTO = z.infer<typeof PublicationRecordDTOSchema>;

/** One row of `publication_list` (newest first). */
export const PublicationSummaryDTOSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  type: PublicationTypeSchema,
  paper: PaperSizeSchema,
  targetPageCount: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicationSummaryDTO = z.infer<typeof PublicationSummaryDTOSchema>;

export const PublicationSaveRequestSchema = z.object({
  projectId: z.string().min(1),
  /** Null creates a new record; an id updates that record. */
  publicationId: z.string().min(1).nullable(),
  publication: PublicationSchema,
  facts: z.array(PublicationFactSchema),
});
export type PublicationSaveRequest = z.infer<typeof PublicationSaveRequestSchema>;
