import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, type AppDatabase, type DbExecutor } from "@/server/db";
import {
  notes,
  projects,
  reminders,
  type NoteRecord,
  type ReminderRecord,
} from "@/server/db/schema";

export interface NoteWithReminders {
  note: NoteRecord;
  tags: string[];
  projectName: string | null;
  projectColorToken: string | null;
  reminders: ReminderRecord[];
}

export interface CreateNoteRowInput {
  userId: string;
  projectId?: string | null;
  title: string;
  content?: string;
  tags?: string[];
  isPinned?: boolean;
}

export interface UpdateNoteRowInput {
  title?: string;
  content?: string;
  tags?: string[];
  isPinned?: boolean;
  projectId?: string | null;
}

export interface NoteRepository {
  create(
    input: CreateNoteRowInput,
    executor?: DbExecutor
  ): Promise<NoteRecord>;
  getById(noteId: string, executor?: DbExecutor): Promise<NoteRecord | null>;
  getByIdForUser(
    noteId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<NoteRecord | null>;
  updateById(
    noteId: string,
    patch: UpdateNoteRowInput,
    executor?: DbExecutor
  ): Promise<NoteRecord | null>;
  updateForUser(
    noteId: string,
    userId: string,
    patch: UpdateNoteRowInput,
    executor?: DbExecutor
  ): Promise<NoteRecord | null>;
  deleteById(noteId: string, executor?: DbExecutor): Promise<boolean>;
  deleteForUser(
    noteId: string,
    userId: string,
    executor?: DbExecutor
  ): Promise<boolean>;
  listNotesWithReminders(
    userId: string,
    filter?: { query?: string; tag?: string }
  ): Promise<NoteWithReminders[]>;
}

export function parseNoteTags(tagsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tagsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function normalizeNoteTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of tags) {
    const normalized = raw.trim().toLowerCase().replace(/^#+/, "");
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      cleaned.push(normalized);
    }
  }
  return cleaned.slice(0, 12);
}

export class DrizzleNoteRepository implements NoteRepository {
  constructor(private readonly database: AppDatabase = db) {}

  async create(
    input: CreateNoteRowInput,
    executor: DbExecutor = this.database
  ): Promise<NoteRecord> {
    const now = Date.now();
    const [created] = await executor
      .insert(notes)
      .values({
        userId: input.userId,
        projectId: input.projectId ?? null,
        title: input.title,
        content: input.content ?? "",
        tagsJson: JSON.stringify(normalizeNoteTags(input.tags)),
        isPinned: input.isPinned ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert note.");
    }
    return created;
  }

  async getById(
    noteId: string,
    executor: DbExecutor = this.database
  ): Promise<NoteRecord | null> {
    const [row] = await executor
      .select()
      .from(notes)
      .where(eq(notes.id, noteId))
      .limit(1);

    return row ?? null;
  }

  async getByIdForUser(
    noteId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<NoteRecord | null> {
    const [row] = await executor
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
      .limit(1);

    return row ?? null;
  }

  async updateById(
    noteId: string,
    patch: UpdateNoteRowInput,
    executor: DbExecutor = this.database
  ): Promise<NoteRecord | null> {
    const updates: Partial<typeof notes.$inferInsert> = {
      updatedAt: Date.now(),
    };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.content !== undefined) updates.content = patch.content;
    if (patch.tags !== undefined) {
      updates.tagsJson = JSON.stringify(normalizeNoteTags(patch.tags));
    }
    if (patch.isPinned !== undefined) updates.isPinned = patch.isPinned;
    if (patch.projectId !== undefined) updates.projectId = patch.projectId;

    const [updated] = await executor
      .update(notes)
      .set(updates)
      .where(eq(notes.id, noteId))
      .returning();

    return updated ?? null;
  }

  async updateForUser(
    noteId: string,
    userId: string,
    patch: UpdateNoteRowInput,
    executor: DbExecutor = this.database
  ): Promise<NoteRecord | null> {
    const updates: Partial<typeof notes.$inferInsert> = {
      updatedAt: Date.now(),
    };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.content !== undefined) updates.content = patch.content;
    if (patch.tags !== undefined) {
      updates.tagsJson = JSON.stringify(normalizeNoteTags(patch.tags));
    }
    if (patch.isPinned !== undefined) updates.isPinned = patch.isPinned;
    if (patch.projectId !== undefined) updates.projectId = patch.projectId;

    const [updated] = await executor
      .update(notes)
      .set(updates)
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
      .returning();

    return updated ?? null;
  }

  async deleteById(
    noteId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(notes)
      .where(eq(notes.id, noteId))
      .returning({ id: notes.id });

    return deleted.length > 0;
  }

  async deleteForUser(
    noteId: string,
    userId: string,
    executor: DbExecutor = this.database
  ): Promise<boolean> {
    const deleted = await executor
      .delete(notes)
      .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
      .returning({ id: notes.id });

    return deleted.length > 0;
  }

  async listNotesWithReminders(
    userId: string,
    filter: { query?: string; tag?: string } = {}
  ): Promise<NoteWithReminders[]> {
    const rows = await this.database
      .select()
      .from(notes)
      .where(and(eq(notes.userId, userId), isNull(notes.projectId)))
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt))
      .limit(150);

    if (rows.length === 0) {
      return [];
    }

    const noteIds = rows.map((n) => n.id);
    const projectIds = Array.from(
      new Set(
        rows
          .map((n) => n.projectId)
          .filter((id): id is string => typeof id === "string")
      )
    );

    const [reminderRows, projectRows] = await Promise.all([
      this.database
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            eq(reminders.entityType, "note"),
            inArray(reminders.entityId, noteIds),
            inArray(reminders.status, ["pending_far", "scheduled", "snoozed"])
          )
        )
        .orderBy(asc(reminders.remindAt)),
      projectIds.length > 0
        ? this.database
            .select({
              id: projects.id,
              name: projects.name,
              colorToken: projects.colorToken,
            })
            .from(projects)
            .where(inArray(projects.id, projectIds))
        : Promise.resolve([]),
    ]);

    const remindersByNote = new Map<string, ReminderRecord[]>();
    for (const rem of reminderRows) {
      const list = remindersByNote.get(rem.entityId) ?? [];
      list.push(rem);
      remindersByNote.set(rem.entityId, list);
    }

    const projectMap = new Map(projectRows.map((p) => [p.id, p]));

    const queryLower = filter.query?.trim().toLowerCase() ?? "";
    const tagLower = filter.tag?.trim().toLowerCase() ?? "";

    return rows
      .map((note) => {
        const tags = parseNoteTags(note.tagsJson);
        const project = note.projectId ? projectMap.get(note.projectId) : null;
        return {
          note,
          tags,
          projectName: project?.name ?? null,
          projectColorToken: project?.colorToken ?? null,
          reminders: remindersByNote.get(note.id) ?? [],
        };
      })
      .filter((item) => {
        if (tagLower && !item.tags.includes(tagLower)) {
          return false;
        }
        if (queryLower) {
          const hay =
            `${item.note.title} ${item.note.content} ${item.tags.join(" ")}`.toLowerCase();
          if (!hay.includes(queryLower)) {
            return false;
          }
        }
        return true;
      });
  }
}

export const noteRepository: NoteRepository = new DrizzleNoteRepository(db);
