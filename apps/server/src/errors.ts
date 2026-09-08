export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const unauthenticated = (msg = "Authentication required") => new AppError(401, "UNAUTHENTICATED", msg);
export const forbidden = (msg = "Forbidden") => new AppError(403, "FORBIDDEN", msg);
export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
