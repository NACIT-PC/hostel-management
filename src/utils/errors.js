/**
 * Typed application errors.
 *
 * The CLI catches `AppError` and prints `error.message` in red without a
 * stack trace; anything else is treated as an unexpected (buggy) failure.
 */

export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', details = [] } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    this.expected = true;
  }
}

/** User typed something invalid (bad number, unknown code, ...). */
export class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, { code: 'VALIDATION_ERROR', details });
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(message, { code: 'NOT_FOUND' });
  }
}

/** Uniqueness / state conflict (duplicate hostel, occupied bed, ...). */
export class ConflictError extends AppError {
  constructor(message) {
    super(message, { code: 'CONFLICT' });
  }
}

/** The authenticated user lacks the required permission. */
export class PermissionError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, { code: 'PERMISSION_DENIED' });
  }
}

/** Business rule about students (fees, gender, year, health) not satisfied. */
export class EligibilityError extends AppError {
  constructor(message, details = []) {
    super(message, { code: 'NOT_ELIGIBLE', details });
  }
}

export function isAppError(error) {
  return error instanceof AppError || error?.expected === true;
}
