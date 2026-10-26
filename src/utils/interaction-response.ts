import type { Interaction, RepliableInteraction } from "discord.js";

const failedInitialResponses = new WeakSet<Interaction>();
const failedDeferredResponses = new WeakSet<Interaction>();
const invalidInteractions = new WeakSet<Interaction>();

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

export function hasInvalidInteractionCode(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === 10062 || code === 40060;
}

export function isInvalidInteraction(interaction: Interaction): boolean {
  return invalidInteractions.has(interaction);
}

export function hasFailedInteractionResponse(
  interaction: Interaction,
): boolean {
  if (!interaction.isRepliable()) return false;

  return (
    (interaction.deferred && failedDeferredResponses.has(interaction)) ||
    (!interaction.deferred && failedInitialResponses.has(interaction))
  );
}

export async function attemptInteractionResponse<T>(
  interaction: RepliableInteraction,
  response: () => Promise<T>,
): Promise<T> {
  const isInitialResponse = !interaction.replied && !interaction.deferred;

  try {
    return await response();
  } catch (error) {
    if (hasInvalidInteractionCode(error)) {
      invalidInteractions.add(interaction);
    } else if (isInitialResponse) {
      failedInitialResponses.add(interaction);
    } else if (interaction.deferred && !interaction.replied) {
      failedDeferredResponses.add(interaction);
    }

    throw error;
  }
}
