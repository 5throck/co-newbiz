// @version 1.0.0
export class MCPConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MCPConfigError";
  }
}
export class MCPNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MCPNetworkError";
  }
}
export class MCPValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MCPValidationError";
  }
}
