export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
  }
}
