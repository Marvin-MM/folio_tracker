import type { OperationDomain } from "@/server/db/schema";
import type { OperationStepType } from "./types";

export interface OperationDomainPreset {
  domain: OperationDomain;
  label: string;
  shortLabel: string;
  description: string;
  prerequisitesLabel: string;
  prerequisitePlaceholder: string;
  emptyPrerequisitesHint: string;
  stepsLabel: string;
  addStepLabel: string;
  verificationLabel: string;
  verificationPlaceholder: string;
  rollbackLabel: string;
  rollbackPlaceholder: string;
  codeBlockLabel: string;
  defaultCodeLanguage: string;
  defaultStepType: OperationStepType;
  showCodeByDefault: boolean;
  showTimerByDefault: boolean;
  suggestedVariableKeys: ReadonlyArray<{
    key: string;
    label: string;
    type: "text" | "number" | "select" | "secret";
    placeholder: string;
  }>;
  badgeClassName: string;
}

export const OPERATION_DOMAIN_PRESETS: Record<
  OperationDomain,
  OperationDomainPreset
> = {
  general: {
    domain: "general",
    label: "General",
    shortLabel: "General",
    description: "Any repeatable checklist, routine, or personal playbook.",
    prerequisitesLabel: "Before You Start",
    prerequisitePlaceholder: "e.g., Gather materials or confirm access",
    emptyPrerequisitesHint: "Add quick items to verify before starting.",
    stepsLabel: "Steps",
    addStepLabel: "Add step",
    verificationLabel: "Verification check",
    verificationPlaceholder: "How do you confirm this step succeeded?",
    rollbackLabel: "Recovery / undo tip",
    rollbackPlaceholder: "What to do if something goes wrong",
    codeBlockLabel: "Reference block / command",
    defaultCodeLanguage: "text",
    defaultStepType: "action",
    showCodeByDefault: false,
    showTimerByDefault: false,
    suggestedVariableKeys: [
      { key: "target_name", label: "Target", type: "text", placeholder: "Name" },
    ],
    badgeClassName: "border-border bg-muted text-muted-foreground",
  },
  tech: {
    domain: "tech",
    label: "Tech & Servers",
    shortLabel: "Tech",
    description: "Server deployments, networking, incident response, and DevOps SOPs.",
    prerequisitesLabel: "Prerequisites & Access",
    prerequisitePlaceholder: "e.g., VPN connected and SSH key loaded",
    emptyPrerequisitesHint:
      "List required access, backups, or maintenance window checks.",
    stepsLabel: "Runbook Steps",
    addStepLabel: "Add runbook step",
    verificationLabel: "Verification command / check",
    verificationPlaceholder: "e.g., curl -I https://{{domain}} returns 200 OK",
    rollbackLabel: "Rollback procedure",
    rollbackPlaceholder: "e.g., Restore backup snapshot and restart service",
    codeBlockLabel: "Command / config snippet",
    defaultCodeLanguage: "bash",
    defaultStepType: "command",
    showCodeByDefault: true,
    showTimerByDefault: false,
    suggestedVariableKeys: [
      { key: "server_ip", label: "Server Host", type: "text", placeholder: "app-01.prod" },
      { key: "domain", label: "Domain", type: "text", placeholder: "app.example.com" },
      { key: "ssh_pass", label: "SSH Password / Token", type: "secret", placeholder: "Entered at runtime" },
    ],
    badgeClassName: "border-collab/30 bg-collab/10 text-collab",
  },
  cooking: {
    domain: "cooking",
    label: "Cooking & Kitchen",
    shortLabel: "Cooking",
    description: "Recipes, meal prep workflows, baking schedules, and fermentation.",
    prerequisitesLabel: "Ingredients & Equipment",
    prerequisitePlaceholder: "e.g., 250g flour, heavy skillet, digital thermometer",
    emptyPrerequisitesHint:
      "List ingredients, prep tools, or oven preheat notes.",
    stepsLabel: "Method",
    addStepLabel: "Add cooking step",
    verificationLabel: "Taste / doneness check",
    verificationPlaceholder: "e.g., Golden brown edges, internal temp 74°C",
    rollbackLabel: "Save / fix tip",
    rollbackPlaceholder: "e.g., If sauce splits, whisk in 1 tbsp warm water",
    codeBlockLabel: "Ratio / timing chart",
    defaultCodeLanguage: "text",
    defaultStepType: "action",
    showCodeByDefault: false,
    showTimerByDefault: true,
    suggestedVariableKeys: [
      { key: "servings", label: "Servings", type: "number", placeholder: "4" },
      { key: "oven_temp", label: "Oven Temp", type: "text", placeholder: "190°C" },
    ],
    badgeClassName: "border-reminder/30 bg-reminder/10 text-reminder",
  },
  fitness: {
    domain: "fitness",
    label: "Fitness & Sport",
    shortLabel: "Fitness",
    description: "Swim sets, strength circuits, mobility drills, and race warmups.",
    prerequisitesLabel: "Gear & Warmup",
    prerequisitePlaceholder: "e.g., Goggles, pull buoy, 5 min shoulder mobility",
    emptyPrerequisitesHint:
      "Add gear to pack, hydration, or warmup cues before starting.",
    stepsLabel: "Drills & Sets",
    addStepLabel: "Add drill / set",
    verificationLabel: "Form / effort cue",
    verificationPlaceholder: "e.g., RPE 7/10, steady bilateral breathing",
    rollbackLabel: "Scale-down option",
    rollbackPlaceholder: "e.g., Drop weight 15% or add 30s rest if form slips",
    codeBlockLabel: "Set breakdown",
    defaultCodeLanguage: "text",
    defaultStepType: "action",
    showCodeByDefault: false,
    showTimerByDefault: true,
    suggestedVariableKeys: [
      { key: "rounds", label: "Rounds", type: "number", placeholder: "4" },
      { key: "pace_target", label: "Target Pace", type: "text", placeholder: "2:00 / 100m" },
    ],
    badgeClassName: "border-done/30 bg-done/10 text-done",
  },
  diy: {
    domain: "diy",
    label: "DIY & Crafts",
    shortLabel: "DIY",
    description: "Woodworking, home repairs, bike maintenance, and hardware builds.",
    prerequisitesLabel: "Tools & Materials",
    prerequisitePlaceholder: "e.g., 4mm hex key, safety glasses, wood glue",
    emptyPrerequisitesHint:
      "List required tools, fasteners, and safety gear first.",
    stepsLabel: "Build Sequence",
    addStepLabel: "Add build step",
    verificationLabel: "Fit / safety check",
    verificationPlaceholder: "e.g., Flush joint, torque bolts to 5 Nm",
    rollbackLabel: "Fix / rework tip",
    rollbackPlaceholder: "e.g., Back out screw slowly and shim before re-drilling",
    codeBlockLabel: "Cut list / measurements",
    defaultCodeLanguage: "text",
    defaultStepType: "action",
    showCodeByDefault: false,
    showTimerByDefault: false,
    suggestedVariableKeys: [
      { key: "width_mm", label: "Width (mm)", type: "number", placeholder: "600" },
      { key: "finish_type", label: "Finish", type: "text", placeholder: "Matte oil" },
    ],
    badgeClassName: "border-reminder/30 bg-muted text-foreground",
  },
  business: {
    domain: "business",
    label: "Business SOP",
    shortLabel: "Business",
    description: "Client onboarding, monthly closes, hiring loops, and launch checklists.",
    prerequisitesLabel: "Required Documents & Approvals",
    prerequisitePlaceholder: "e.g., Signed SOW and billing contact confirmed",
    emptyPrerequisitesHint:
      "List documents, sign-offs, or stakeholder inputs required upfront.",
    stepsLabel: "SOP Steps",
    addStepLabel: "Add SOP step",
    verificationLabel: "Sign-off / audit check",
    verificationPlaceholder: "e.g., Confirmation email archived in client folder",
    rollbackLabel: "Escalation / fallback",
    rollbackPlaceholder: "e.g., Notify account lead if invoice bounces",
    codeBlockLabel: "Message / email template",
    defaultCodeLanguage: "text",
    defaultStepType: "action",
    showCodeByDefault: false,
    showTimerByDefault: false,
    suggestedVariableKeys: [
      { key: "client_name", label: "Client Name", type: "text", placeholder: "Acme Corp" },
      { key: "quarter", label: "Period", type: "text", placeholder: "Q4 2026" },
    ],
    badgeClassName: "border-border bg-muted text-foreground",
  },
  study: {
    domain: "study",
    label: "Study & Research",
    shortLabel: "Study",
    description: "Deep-work study protocols, lab procedures, exam prep, and reading workflows.",
    prerequisitesLabel: "Materials & Setup",
    prerequisitePlaceholder: "e.g., Textbook chapter, blank flashcards, phone on DND",
    emptyPrerequisitesHint:
      "List notes, references, or focus environment checks.",
    stepsLabel: "Study Blocks",
    addStepLabel: "Add study block",
    verificationLabel: "Recall / mastery check",
    verificationPlaceholder: "e.g., Explain concept aloud without looking at notes",
    rollbackLabel: "If stuck",
    rollbackPlaceholder: "e.g., Step back to worked examples before retrying",
    codeBlockLabel: "Formula / prompt",
    defaultCodeLanguage: "text",
    defaultStepType: "action",
    showCodeByDefault: false,
    showTimerByDefault: true,
    suggestedVariableKeys: [
      { key: "topic", label: "Topic", type: "text", placeholder: "Chapter 4" },
      { key: "block_minutes", label: "Block Minutes", type: "number", placeholder: "25" },
    ],
    badgeClassName: "border-collab/30 bg-muted text-collab",
  },
};

export function getOperationDomainPreset(
  domain: OperationDomain
): OperationDomainPreset {
  return OPERATION_DOMAIN_PRESETS[domain] ?? OPERATION_DOMAIN_PRESETS.general;
}
