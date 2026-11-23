import { serve } from "inngest/next";
import { inngest } from "@/server/inngest/client";
import { inngestFunctions } from "@/server/inngest/registry";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
