import type { Prisma, PrismaClient, User } from '@prisma/client';
import type { UserDto } from '@kirana/shared';

export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  findByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { email } });
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.db.user.update({ where: { id }, data });
  }
}

export function toUserDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    uiLanguage: u.uiLanguage,
    speechLocale: u.speechLocale as UserDto['speechLocale'],
  };
}
