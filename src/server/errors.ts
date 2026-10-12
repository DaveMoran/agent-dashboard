export class AppError extends Error {
  exitCode = 1;
}

export class UsageError extends AppError {
  exitCode = 2;
}