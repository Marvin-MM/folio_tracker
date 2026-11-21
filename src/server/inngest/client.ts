import { Inngest } from "inngest";

const isDev =
  process.env.INNGEST_DEV === "1" || process.env.NODE_ENV === "development";

export const inngest = new Inngest({
  id: "folio",
  isDev,
  ...(process.env.INNGEST_EVENT_KEY?.trim()
    ? { eventKey: process.env.INNGEST_EVENT_KEY.trim() }
    : {}),
  ...(process.env.INNGEST_SIGNING_KEY?.trim()
    ? { signingKey: process.env.INNGEST_SIGNING_KEY.trim() }
    : {}),
});
