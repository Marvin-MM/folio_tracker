import type {
  OperationDifficulty,
  OperationDomain,
  OperationRecord,
  OperationVersionRecord,
  OperationVisibility,
} from "@/server/db/schema";
import { computeOperationStaleness, type OperationStalenessInfo } from "./slug";
import {
  parseOperationTagsJson,
  parsePrerequisitesJson,
  parseStepsSnapshotJson,
  parseVariablesSchemaJson,
  type OperationPrerequisite,
  type OperationStep,
  type OperationVariable,
} from "./types";

/**
 * STRICT PUBLIC DATA BOUNDARY DTOs.
 *
 * SECURITY INVARIANT:
 * None of these types may EVER contain:
 * - `email`, `unlistedTokenHash`, `projectId`, `linkedHabitId`
 * - `operationMembers`, `operationInvitations`, `operationRuns`, `operationStepFlags`
 */
export interface PublicCreatorSummaryDto {
  id: string;
  name: string;
  handle: string | null;
  bio: string | null;
}

export interface PublicOperationForkSourceDto {
  slug: string;
  title: string;
  creatorHandle: string | null;
  creatorName: string | null;
}

export interface PublicOperationCardDto {
  id: string;
  slug: string;
  title: string;
  summary: string;
  domain: OperationDomain;
  tags: string[];
  difficulty: OperationDifficulty | null;
  estimatedMinutes: number | null;
  allowForking: boolean;
  currentVersion: number;
  forkCount: number;
  stepCount: number;
  lastVerifiedAt: number | null;
  reviewCycleDays: number | null;
  staleness: OperationStalenessInfo;
  updatedAt: number;
  creator: PublicCreatorSummaryDto;
}

export interface PublicOperationDetailDto {
  id: string;
  slug: string;
  title: string;
  summary: string;
  domain: OperationDomain;
  visibility: Extract<OperationVisibility, "public" | "unlisted">;
  tags: string[];
  difficulty: OperationDifficulty | null;
  estimatedMinutes: number | null;
  allowForking: boolean;
  currentVersion: number;
  forkCount: number;
  forkedFrom: PublicOperationForkSourceDto | null;
  reviewCycleDays: number | null;
  lastVerifiedAt: number | null;
  staleness: OperationStalenessInfo;
  updatedAt: number;
  creator: PublicCreatorSummaryDto;
  version: {
    id: string;
    versionNumber: number;
    changeSummary: string | null;
    createdAt: number;
    variables: OperationVariable[];
    prerequisites: OperationPrerequisite[];
    steps: OperationStep[];
  };
}

export interface PublicCreatorProfileDto {
  creator: PublicCreatorSummaryDto & { handle: string };
  followerCount: number;
  followingCount: number;
  publicOperationsCount: number;
  operations: PublicOperationCardDto[];
}

export function toPublicOperationCardDto(params: {
  operation: Pick<
    OperationRecord,
    | "id"
    | "slug"
    | "title"
    | "summary"
    | "domain"
    | "tagsJson"
    | "difficulty"
    | "estimatedMinutes"
    | "allowForking"
    | "currentVersion"
    | "forkCount"
    | "lastVerifiedAt"
    | "reviewCycleDays"
    | "createdAt"
    | "updatedAt"
  >;
  stepCount: number;
  creator: {
    id: string;
    name: string;
    handle: string | null;
    bio: string | null;
  };
  nowMs?: number;
}): PublicOperationCardDto {
  const { operation, stepCount, creator, nowMs } = params;
  return {
    id: operation.id,
    slug: operation.slug,
    title: operation.title,
    summary: operation.summary,
    domain: operation.domain,
    tags: parseOperationTagsJson(operation.tagsJson),
    difficulty: operation.difficulty,
    estimatedMinutes: operation.estimatedMinutes,
    allowForking: operation.allowForking,
    currentVersion: operation.currentVersion,
    forkCount: operation.forkCount,
    stepCount,
    lastVerifiedAt: operation.lastVerifiedAt,
    reviewCycleDays: operation.reviewCycleDays,
    staleness: computeOperationStaleness({
      reviewCycleDays: operation.reviewCycleDays,
      lastVerifiedAt: operation.lastVerifiedAt,
      createdAt: operation.createdAt,
      nowMs,
    }),
    updatedAt: operation.updatedAt,
    creator: {
      id: creator.id,
      name: creator.name,
      handle: creator.handle,
      bio: creator.bio,
    },
  };
}

export function toPublicOperationDetailDto(params: {
  operation: Pick<
    OperationRecord,
    | "id"
    | "slug"
    | "title"
    | "summary"
    | "domain"
    | "visibility"
    | "tagsJson"
    | "difficulty"
    | "estimatedMinutes"
    | "allowForking"
    | "currentVersion"
    | "forkCount"
    | "reviewCycleDays"
    | "lastVerifiedAt"
    | "createdAt"
    | "updatedAt"
  >;
  version: Pick<
    OperationVersionRecord,
    | "id"
    | "versionNumber"
    | "changeSummary"
    | "createdAt"
    | "variablesSchemaJson"
    | "prerequisitesJson"
    | "stepsSnapshotJson"
  >;
  creator: {
    id: string;
    name: string;
    handle: string | null;
    bio: string | null;
  };
  forkedFrom?: PublicOperationForkSourceDto | null;
  nowMs?: number;
}): PublicOperationDetailDto {
  const { operation, version, creator, forkedFrom = null, nowMs } = params;
  const safeVisibility: Extract<OperationVisibility, "public" | "unlisted"> =
    operation.visibility === "unlisted" ? "unlisted" : "public";

  return {
    id: operation.id,
    slug: operation.slug,
    title: operation.title,
    summary: operation.summary,
    domain: operation.domain,
    visibility: safeVisibility,
    tags: parseOperationTagsJson(operation.tagsJson),
    difficulty: operation.difficulty,
    estimatedMinutes: operation.estimatedMinutes,
    allowForking: operation.allowForking,
    currentVersion: operation.currentVersion,
    forkCount: operation.forkCount,
    forkedFrom,
    reviewCycleDays: operation.reviewCycleDays,
    lastVerifiedAt: operation.lastVerifiedAt,
    staleness: computeOperationStaleness({
      reviewCycleDays: operation.reviewCycleDays,
      lastVerifiedAt: operation.lastVerifiedAt,
      createdAt: operation.createdAt,
      nowMs,
    }),
    updatedAt: operation.updatedAt,
    creator: {
      id: creator.id,
      name: creator.name,
      handle: creator.handle,
      bio: creator.bio,
    },
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      changeSummary: version.changeSummary,
      createdAt: version.createdAt,
      variables: parseVariablesSchemaJson(version.variablesSchemaJson),
      prerequisites: parsePrerequisitesJson(version.prerequisitesJson),
      steps: parseStepsSnapshotJson(version.stepsSnapshotJson),
    },
  };
}
