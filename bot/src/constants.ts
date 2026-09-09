/** Shared constants used across commands, events and the setup script. */

/** Button custom-id for the verification message (setupServer.ts ↔ interactionCreate.ts). */
export const VERIFY_BUTTON_ID = "verify_user";

/** Role granted by the verification button. Overridable so a renamed role still works. */
export const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME?.trim() || "Verified";

/** CraftPanel accent (orange), as a Discord color int. */
export const ACCENT = 0xff8c00;
