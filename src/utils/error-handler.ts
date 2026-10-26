import {
  MessageFlags,
  type Interaction,
} from "discord.js";
import { errorLog } from "../../logs/printLogs.js";
import { sendError } from "../ui/utils/sendError.js";
import {
  hasFailedInteractionResponse,
  hasInvalidInteractionCode,
  isInvalidInteraction,
} from "./interaction-response.js";
export {
  attemptInteractionResponse,
  hasInvalidInteractionCode,
} from "./interaction-response.js";

const defaultInteractionErrorMessage =
  "Something went wrong. Please try again.";
const loggedErrors = new WeakSet<object>();

export class UserFacingError extends Error {}

export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof UserFacingError;
}

function getErrorCode(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number"
  ) {
    return error.code;
  }

  return undefined;
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/[\r\n]+/g, " ")
    .replace(/Bearer\s+[\w./+=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(authorization|token|password|secret|api[-_ ]?key|cvv|card(?:number)?)\b[\s=:]+[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b(?:\d[ -]*?){3,}\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_./+=-]{24,}\b/g, "[REDACTED]")
    .slice(0, 300);
}

function getSafeErrorDetails(error: unknown): string {
  let type = "UnknownError";
  const code = getErrorCode(error);
  let message = "";

  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)) {
    type = error.name;
    message = sanitizeErrorMessage(error.message);
  }

  if (error && typeof error === "object") {
    if (loggedErrors.has(error)) return "";
    loggedErrors.add(error);
  }

  const details = [`type=${type}`, `code=${code ?? "none"}`];
  if (message) details.push(`message=${message}`);
  return details.join(" ");
}

export function logApplicationError(context: string, error: unknown): void {
  if (isUserFacingError(error)) return;

  try {
    const details = getSafeErrorDetails(error);
    if (details) errorLog(`${context}: ${details}`);
  } catch {
    try {
      process.stderr.write(`${context}: error logging failed.\n`);
    } catch {}
  }
}

export async function handleInteractionError(
  interaction: Interaction,
  error: unknown,
  responseMessage = defaultInteractionErrorMessage,
): Promise<void> {
  if (hasInvalidInteractionCode(error)) return;

  if (!isUserFacingError(error)) {
    logApplicationError("Interaction error", error);
  }

  try {
    if (
      !interaction.isRepliable() ||
      interaction.replied ||
      isInvalidInteraction(interaction) ||
      hasFailedInteractionResponse(interaction)
    ) {
      return;
    }

    const message = isUserFacingError(error) ? error.message : responseMessage;

    await sendError(interaction, {
      title: "Something Went Wrong",
      description: message,
      footer: "Please try again later. Contact support if the issue persists.",
    });
  } catch (responseError) {
    if (!hasInvalidInteractionCode(responseError)) {
      logApplicationError(
        "Failed to send interaction error response",
        responseError,
      );
    }
  }
}

export function registerGlobalErrorHandlers(
  shutdown: () => Promise<void>,
): (context: string, error: unknown) => void {
  let shutdownStarted = false;

  const handleFatalError = (context: string, error: unknown): void => {
    logApplicationError(context, error);
    process.exitCode = 1;

    if (shutdownStarted) return;
    shutdownStarted = true;

    void (async () => {
      try {
        await shutdown();
      } catch (shutdownError) {
        logApplicationError("Application shutdown failed", shutdownError);
      } finally {
        process.exit(1);
      }
    })().catch((shutdownError: unknown) => {
      logApplicationError("Fatal error shutdown failed", shutdownError);
      process.exit(1);
    });
  };

  process.on("uncaughtException", (error) => {
    handleFatalError("Uncaught exception", error);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    handleFatalError("Unhandled promise rejection", reason);
  });

  return handleFatalError;
}
