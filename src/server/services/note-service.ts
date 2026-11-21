import {
  assertProjectRole,
  createDrizzleMembershipLookup,
  type ProjectMembershipLookup,
} from "@/server/dal/auth-guard";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/dal/errors";
import {
  noteRepository,
  type NoteRepository,
} from "@/server/dal/note-repository";
import {
  projectRepository,
  type ProjectRepository,
} from "@/server/dal/project-repository";
import {
  reminderRepository,
  type ReminderRepository,
} from "@/server/dal/reminder-repository";
import { db, type AppDatabase } from "@/server/db";
import type { NoteRecord, ReminderRecord } from "@/server/db/schema";
import {
  defaultEventBus,
  type AppDomainEvent,
  type EventBus,
} from "@/server/providers/event-bus";
import {
  defaultPermissionCache,
  type PermissionCache,
} from "@/server/providers/redis/permission-cache";
import { ReminderService } from "./reminder-service";

export interface CreateNoteInput {
  title: string;
  content?: string;
  tags?: string[];
  isPinned?: boolean;
  projectId?: string | null;
  remindAt?: number | null;
  timezone?: string;
}

export interface UpdateNoteInput {
  title?: string;
  content?: string;
  tags?: string[];
  isPinned?: boolean;
  projectId?: string | null;
}

export interface NoteServiceDeps {
  database?: AppDatabase;
  notes?: NoteRepository;
  reminders?: ReminderRepository;
  projects?: ProjectRepository;
  membershipLookup?: ProjectMembershipLookup;
  permissionCache?: PermissionCache;
  reminderService?: ReminderService;
  eventBus?: EventBus;
}

export class NoteService {
  private readonly database: AppDatabase;
  private readonly notes: NoteRepository;
  private readonly reminders: ReminderRepository;
  private readonly projects: ProjectRepository;
  private readonly membershipLookup: ProjectMembershipLookup;
  private readonly permissionCache: PermissionCache;
  private readonly reminderService: ReminderService;
  private readonly eventBus: EventBus;

  constructor(deps: NoteServiceDeps = {}) {
    this.database = deps.database ?? db;
    this.notes = deps.notes ?? noteRepository;
    this.reminders = deps.reminders ?? reminderRepository;
    this.projects = deps.projects ?? projectRepository;
    this.membershipLookup =
      deps.membershipLookup ?? createDrizzleMembershipLookup(this.database);
    this.permissionCache = deps.permissionCache ?? defaultPermissionCache;
    this.eventBus = deps.eventBus ?? defaultEventBus;
    this.reminderService =
      deps.reminderService ??
      new ReminderService({
        database: this.database,
        reminders: this.reminders,
        notes: this.notes,
        membershipLookup: this.membershipLookup,
        permissionCache: this.permissionCache,
        eventBus: this.eventBus,
      });
  }

  private async assertCanMutateNote(
    note: NoteRecord,
    userId: string
  ): Promise<void> {
    if (note.projectId) {
      await assertProjectRole(
        note.projectId,
        userId,
        ["owner", "editor"],
        this.membershipLookup,
        this.permissionCache
      );
      return;
    }

    if (note.userId !== userId) {
      throw new ForbiddenError();
    }
  }

  async createNote(
    userId: string,
    input: CreateNoteInput
  ): Promise<{ note: NoteRecord; reminder: ReminderRecord | null }> {
    const title = input.title.trim();
    if (!title) {
      throw new ValidationError("Note title cannot be empty.");
    }

    if (input.projectId) {
      await assertProjectRole(
        input.projectId,
        userId,
        ["owner", "editor"],
        this.membershipLookup,
        this.permissionCache
      );
    }

    const { note, reminder, postCommitEvent } = await this.database.transaction(
      async (tx) => {
        const createdNote = await this.notes.create(
          {
            userId,
            title,
            content: input.content ?? "",
            tags: input.tags ?? [],
            isPinned: input.isPinned ?? false,
            projectId: input.projectId ?? null,
          },
          tx
        );

        let createdReminder: ReminderRecord | null = null;
        let eventToEmit: AppDomainEvent | null = null;

        if (input.remindAt !== undefined && input.remindAt !== null) {
          const attached = await this.reminderService.createInTransaction(
            tx,
            userId,
            {
              entityType: "note",
              entityId: createdNote.id,
              remindAt: input.remindAt,
              timezone: input.timezone ?? "UTC",
            }
          );
          createdReminder = attached.reminder;
          eventToEmit = attached.postCommitEvent;
        }

        if (createdNote.projectId) {
          await this.projects.recordActivity(
            {
              projectId: createdNote.projectId,
              actorId: userId,
              action: "note.created",
              entityType: "note",
              entityId: createdNote.id,
              metadata: { title: createdNote.title },
            },
            tx
          );
        }

        return {
          note: createdNote,
          reminder: createdReminder,
          postCommitEvent: eventToEmit,
        };
      }
    );

    if (postCommitEvent) {
      await this.eventBus.emit(postCommitEvent);
    }

    return { note, reminder };
  }

  async updateNote(
    userId: string,
    noteId: string,
    input: UpdateNoteInput
  ): Promise<NoteRecord> {
    if (input.title !== undefined && !input.title.trim()) {
      throw new ValidationError("Note title cannot be empty.");
    }

    const existing = await this.notes.getById(noteId);
    if (!existing) {
      throw new NotFoundError("Note not found.");
    }
    await this.assertCanMutateNote(existing, userId);

    if (input.projectId && input.projectId !== existing.projectId) {
      await assertProjectRole(
        input.projectId,
        userId,
        ["owner", "editor"],
        this.membershipLookup,
        this.permissionCache
      );
    }

    return this.database.transaction(async (tx) => {
      const updated = await this.notes.updateById(
        noteId,
        {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
          ...(input.projectId !== undefined
            ? { projectId: input.projectId }
            : {}),
        },
        tx
      );

      if (!updated) {
        throw new NotFoundError("Note not found.");
      }

      if (updated.projectId) {
        await this.projects.recordActivity(
          {
            projectId: updated.projectId,
            actorId: userId,
            action: "note.updated",
            entityType: "note",
            entityId: updated.id,
            metadata: { title: updated.title },
          },
          tx
        );
      }

      return updated;
    });
  }

  async togglePin(userId: string, noteId: string): Promise<NoteRecord> {
    const existing = await this.notes.getById(noteId);
    if (!existing) {
      throw new NotFoundError("Note not found.");
    }
    await this.assertCanMutateNote(existing, userId);

    const updated = await this.notes.updateById(noteId, {
      isPinned: !existing.isPinned,
    });

    if (!updated) {
      throw new NotFoundError("Note not found.");
    }
    return updated;
  }

  async deleteNote(userId: string, noteId: string): Promise<void> {
    const existing = await this.notes.getById(noteId);
    if (!existing) {
      throw new NotFoundError("Note not found.");
    }
    await this.assertCanMutateNote(existing, userId);

    const cancelledEvents = await this.database.transaction(async (tx) => {
      const cancelled = await this.reminders.cancelActiveForEntity(
        { userId, entityType: "note", entityId: noteId },
        tx
      );

      await this.notes.deleteById(noteId, tx);

      if (existing.projectId) {
        await this.projects.recordActivity(
          {
            projectId: existing.projectId,
            actorId: userId,
            action: "note.deleted",
            entityType: "note",
            entityId: noteId,
            metadata: { title: existing.title },
          },
          tx
        );
      }

      return cancelled.map<AppDomainEvent>((row) => ({
        name: "app/reminder.cancelled",
        data: {
          reminderId: row.id,
          userId,
          version: row.version,
        },
      }));
    });

    if (cancelledEvents.length > 0) {
      await this.eventBus.emit(cancelledEvents);
    }
  }
}

export const noteService = new NoteService();
