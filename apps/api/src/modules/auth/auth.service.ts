import { Prisma, type PrismaClient, type User } from '@prisma/client';
import type { LoginInput, RegisterInput, UpdatePreferencesInput } from '@kirana/shared';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../audit/audit.service.js';
import type { UserRepository } from './user.repository.js';

export class AuthService {
  constructor(
    private readonly db: PrismaClient,
    private readonly users: UserRepository,
  ) {}

  async register(input: RegisterInput): Promise<User> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            displayName: input.displayName,
            uiLanguage: input.uiLanguage,
          },
        });
        await recordAudit(tx, {
          actorUserId: user.id,
          action: 'user.registered',
          entityType: 'User',
          entityId: user.id,
        });
        return user;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw e;
    }
  }

  /** Same error and comparable timing for unknown email and wrong password. */
  async login(input: LoginInput): Promise<User> {
    const user = await this.users.findByEmail(input.email);
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    return user;
  }

  updatePreferences(userId: string, input: UpdatePreferencesInput): Promise<User> {
    return this.users.update(userId, input);
  }
}
