export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', details = [] } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    this.expected = true;
  }
}

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

export class ConflictError extends AppError {
  constructor(message) {
    super(message, { code: 'CONFLICT' });
  }
}

export class PermissionError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, { code: 'PERMISSION_DENIED' });
  }
}

export class EligibilityError extends AppError {
  constructor(message, details = []) {
    super(message, { code: 'NOT_ELIGIBLE', details });
  }
}

export function isAppError(error) {
  return error instanceof AppError || error?.expected === true;
}
