export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission for this action');
/** Used for both "missing" and "not yours" so tenants cannot probe each other's ids. */
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
