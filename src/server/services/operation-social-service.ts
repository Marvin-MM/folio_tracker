import { NotFoundError, ValidationError } from "@/server/dal/errors";
import {
  operationsSocialRepository,
  type OperationsSocialRepository,
} from "@/server/dal/operations-social";
import {
  userRepository,
  type UserRepository,
} from "@/server/dal/user-repository";
import { withDbRetry, type AppDatabase } from "@/server/db";

export interface OperationSocialServiceDeps {
  database?: AppDatabase;
  social?: OperationsSocialRepository;
  users?: UserRepository;
  now?: () => number;
}

export class OperationSocialService {
  private readonly social: OperationsSocialRepository;
  private readonly users: UserRepository;
  private readonly now: () => number;

  constructor(deps: OperationSocialServiceDeps = {}) {
    this.social = deps.social ?? operationsSocialRepository;
    this.users = deps.users ?? userRepository;
    this.now = deps.now ?? (() => Date.now());
  }

  async followCreator(
    followerId: string,
    targetUserId: string
  ): Promise<{ following: true; followerCount: number; targetHandle: string | null }> {
    if (!followerId || !targetUserId || followerId === targetUserId) {
      throw new ValidationError("You cannot follow your own account.");
    }

    const target = await this.users.getById(targetUserId);
    if (!target || target.isSuspended) {
      throw new NotFoundError("Creator not found.");
    }

    await withDbRetry(() =>
      this.social.followUser(followerId, targetUserId, this.now())
    );
    const counts = await this.social.getFollowCounts(targetUserId);
    return {
      following: true,
      followerCount: counts.followerCount,
      targetHandle: target.handle,
    };
  }

  async unfollowCreator(
    followerId: string,
    targetUserId: string
  ): Promise<{ following: false; followerCount: number; targetHandle: string | null }> {
    if (!followerId || !targetUserId) {
      throw new ValidationError("Invalid creator ID.");
    }
    const target = await this.users.getById(targetUserId);
    await withDbRetry(() => this.social.unfollowUser(followerId, targetUserId));
    const counts = await this.social.getFollowCounts(targetUserId);
    return {
      following: false,
      followerCount: counts.followerCount,
      targetHandle: target?.handle ?? null,
    };
  }

  async isFollowing(followerId: string, targetUserId: string): Promise<boolean> {
    if (!followerId || !targetUserId || followerId === targetUserId) {
      return false;
    }
    return this.social.isFollowing(followerId, targetUserId);
  }
}

export const operationSocialService = new OperationSocialService();
