import type { StoreRole, User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` when a valid session cookie is present. */
      auth?: { user: User; sessionId: string };
      /** Set by `requireStoreMember`; derived from the DB membership, never from client input. */
      tenant?: { storeId: string; role: StoreRole };
    }
  }
}

export {};
