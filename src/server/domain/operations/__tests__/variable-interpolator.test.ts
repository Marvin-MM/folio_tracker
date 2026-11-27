import { describe, expect, it } from "vitest";
import {
  extractTemplateVariableKeys,
  interpolateStep,
  interpolateTemplate,
  stripSecretVariables,
  type OperationStep,
  type OperationVariable,
} from "@/server/domain/operations";

const SCHEMA: OperationVariable[] = [
  { key: "server_ip", label: "Server IP", type: "text", required: true, defaultValue: "10.0.0.10" },
  { key: "servings", label: "Servings", type: "number", required: false, defaultValue: "4" },
  { key: "ssh_pass", label: "SSH Password", type: "secret", required: true },
  { key: "env", label: "Environment", type: "select", required: false, options: ["staging", "prod"], defaultValue: "staging" },
];

describe("variable-interpolator", () => {
  it("performs strictly single-pass non-recursive substitution", () => {
    // If server_ip contains {{ssh_pass}}, it MUST NOT expand {{ssh_pass}}!
    const result = interpolateTemplate(
      "ssh root@{{server_ip}} --env={{ env }}",
      {
        server_ip: "host-{{ssh_pass}}",
        ssh_pass: "TOP_SECRET_PASSWORD",
      },
      SCHEMA
    );

    expect(result.text).toBe("ssh root@host-{{ssh_pass}} --env=staging");
    expect(result.text).not.toContain("TOP_SECRET_PASSWORD");
    expect(result.unresolvedKeys).toEqual([]);
  });

  it("falls back to non-secret schema defaultValue and records unresolved placeholders", () => {
    const result = interpolateTemplate(
      "Scale to {{servings}} servings on {{server_ip}} using {{ssh_pass}} and {{unknown_var}}",
      {},
      SCHEMA
    );

    expect(result.text).toBe(
      "Scale to 4 servings on 10.0.0.10 using {{ssh_pass}} and {{unknown_var}}"
    );
    expect(result.unresolvedKeys).toEqual(["ssh_pass", "unknown_var"]);
  });

  it("never falls back to defaultValue on a secret variable even if one were passed in schema", () => {
    const badSchema: OperationVariable[] = [
      { key: "ssh_pass", label: "SSH Password", type: "secret", required: true, defaultValue: "LEAKED" },
    ];
    const result = interpolateTemplate("pw={{ssh_pass}}", {}, badSchema);
    expect(result.text).toBe("pw={{ssh_pass}}");
    expect(result.unresolvedKeys).toEqual(["ssh_pass"]);
  });

  it("interpolates all step fields including codeBlock, verificationCue, rollbackHint, and branchHint", () => {
    const step: OperationStep = {
      key: "s1",
      position: "a0",
      type: "command",
      title: "Deploy to {{server_ip}}",
      bodyMarkdown: "Connect to **{{server_ip}}** for {{env}}.",
      codeBlock: {
        language: "bash",
        content: "SSHPASS='{{ssh_pass}}' ssh deploy@{{server_ip}}",
      },
      timerSeconds: 30,
      verificationCue: "curl https://{{server_ip}}/healthz",
      rollbackHint: "Revert release on {{server_ip}}",
      branchHint: "If {{env}} == prod, alert ops",
    };

    const out = interpolateStep(
      step,
      { server_ip: "app-01.prod", ssh_pass: "ram-secret", env: "prod" },
      SCHEMA
    );

    expect(out.title).toBe("Deploy to app-01.prod");
    expect(out.bodyMarkdown).toBe("Connect to **app-01.prod** for prod.");
    expect(out.codeBlock?.content).toBe(
      "SSHPASS='ram-secret' ssh deploy@app-01.prod"
    );
    expect(out.verificationCue).toBe("curl https://app-01.prod/healthz");
    expect(out.rollbackHint).toBe("Revert release on app-01.prod");
    expect(out.branchHint).toBe("If prod == prod, alert ops");
    expect(out.unresolvedKeys).toEqual([]);
  });

  it("stripSecretVariables strictly excludes secret keys AND undeclared keys", () => {
    const cleaned = stripSecretVariables(
      {
        server_ip: "app-01.prod",
        servings: "6",
        ssh_pass: "ULTRA_SECRET_123",
        rogue_key: "unexpected_secret",
      },
      SCHEMA
    );

    expect(cleaned).toEqual({
      server_ip: "app-01.prod",
      servings: "6",
    });
    expect(cleaned).not.toHaveProperty("ssh_pass");
    expect(cleaned).not.toHaveProperty("rogue_key");
  });

  it("extracts unique placeholder variable keys cleanly", () => {
    expect(
      extractTemplateVariableKeys(
        "Use {{ server_ip }} then {{servings}} and {{server_ip}}"
      )
    ).toEqual(["server_ip", "servings"]);
  });
});
