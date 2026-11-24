"use server";

import { z } from "zod";
import { requireSession } from "@/server/dal/auth-guard";
import type { NoteRecord, ReminderRecord } from "@/server/db/schema";
import { noteService } from "@/server/services/note-service";
import {
  actionErr,
  actionOk,
  mapErrorToActionResult,
  type ActionResult,
} from "./types";

const createNoteSchema = z.object({
  title: z.string().trim().min(1, "Note title is required.").max(240),
  content: z.string().max(100_000).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  isPinned: z.boolean().optional(),
  projectId: z.string().min(1).nullable().optional(),
  remindAt: z.number().int().positive().nullable().optional(),
});

const updateNoteSchema = z.object({
  noteId: z.string().min(1),
  title: z.string().trim().min(1, "Note title is required.").max(240).optional(),
  content: z.string().max(100_000).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  isPinned: z.boolean().optional(),
  projectId: z.string().min(1).nullable().optional(),
});

const noteIdSchema = z.object({
  noteId: z.string().min(1),
});

function revalidateNotePaths() {
  // Client freshness is driven by TanStack Query domain invalidation; hard reloads read live Turso.
}

export async function createNoteAction(
  input: z.input<typeof createNoteSchema>
): Promise<ActionResult<{ note: NoteRecord; reminder: ReminderRecord | null }>> {
  const parsed = createNoteSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please check your note details.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const created = await noteService.createNote(user.id, {
      ...parsed.data,
      timezone: user.timezone || "UTC",
    });
    revalidateNotePaths();
    return actionOk(created);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function updateNoteAction(
  input: z.input<typeof updateNoteSchema>
): Promise<ActionResult<NoteRecord>> {
  const parsed = updateNoteSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr(
      "VALIDATION_ERROR",
      "Please check your note changes.",
      parsed.error.flatten().fieldErrors
    );
  }

  try {
    const { user } = await requireSession();
    const { noteId, ...patch } = parsed.data;
    const updated = await noteService.updateNote(user.id, noteId, patch);
    revalidateNotePaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function toggleNotePinAction(
  input: z.input<typeof noteIdSchema>
): Promise<ActionResult<NoteRecord>> {
  const parsed = noteIdSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid note identifier.");
  }

  try {
    const { user } = await requireSession();
    const updated = await noteService.togglePin(user.id, parsed.data.noteId);
    revalidateNotePaths();
    return actionOk(updated);
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}

export async function deleteNoteAction(
  input: z.input<typeof noteIdSchema>
): Promise<ActionResult<{ deletedId: string }>> {
  const parsed = noteIdSchema.safeParse(input);
  if (!parsed.success) {
    return actionErr("VALIDATION_ERROR", "Invalid note identifier.");
  }

  try {
    const { user } = await requireSession();
    await noteService.deleteNote(user.id, parsed.data.noteId);
    revalidateNotePaths();
    return actionOk({ deletedId: parsed.data.noteId });
  } catch (error) {
    return mapErrorToActionResult(error);
  }
}
