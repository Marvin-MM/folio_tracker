import { describe, expect, it } from "vitest";
import { scanOperationForSecrets } from "@/server/domain/operations";

describe("secret-scanner", () => {
  it("blocks PEM private keys, credentialed DB URLs, provider keys, Bearer tokens, and literal passwords", () => {
    // Assemble synthetic secret test fixtures dynamically so static repository
    // push-protection scanners never false-positive on test vectors.
    const fakePemHeader = ["-----BEGIN ", "OPENSSH PRIVATE KEY-----"].join("");
    const fakeStripeKey = ["sk", "live", "51N9xAbCdEfGhIjKlMnOpQrStUv"].join("_");
    const fakeGithubToken = ["ghp", "1234567890abcdefghij1234567890"].join("_");
    const fakeAwsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const fakeResendKey = ["re", "1234567890abcdefghijklmno"].join("_");

    const report = scanOperationForSecrets({
      title: "Production Server Setup",
      summary: "Connects to postgres://admin:Sup3rS3cret!@db.prod.internal:5432/app",
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "command",
          title: "Configure keys",
          bodyMarkdown: [
            fakePemHeader,
            `Use Stripe key ${fakeStripeKey}`,
            `GitHub: ${fakeGithubToken}`,
            `AWS: ${fakeAwsKey}`,
            "Header: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
          ].join("\n"),
          codeBlock: {
            language: "bash",
            content: `export api_key="${fakeResendKey}"\npassword=MyRealProdPass99!`,
          },
        },
      ],
    });

    expect(report.hasBlockers).toBe(true);
    const ruleIds = new Set(report.blockers.map((b) => b.ruleId));
    expect(ruleIds.has("private_key_pem")).toBe(true);
    expect(ruleIds.has("database_url_credentials")).toBe(true);
    expect(ruleIds.has("provider_secret_key")).toBe(true);
    expect(ruleIds.has("github_token")).toBe(true);
    expect(ruleIds.has("aws_access_key")).toBe(true);
    expect(ruleIds.has("jwt_token")).toBe(true);
    expect(ruleIds.has("resend_api_key")).toBe(true);
    expect(ruleIds.has("credential_assignment")).toBe(true);

    // Raw secrets must NEVER appear verbatim in redactedMatch!
    for (const finding of report.findings) {
      expect(finding.redactedMatch).not.toContain("Sup3rS3cret!");
      expect(finding.redactedMatch).not.toContain("MyRealProdPass99!");
      expect(finding.redactedMatch).not.toContain(fakeStripeKey);
    }
  });

  it("allows safe {{variable}} templates, $ENV_VARS, and placeholder tokens without false-positive blockers", () => {
    const report = scanOperationForSecrets({
      title: "Zero-Downtime Nginx Deploy",
      summary: "Safe blueprint using dynamic variables.",
      variables: [
        { key: "db_pass", label: "DB Password", type: "secret", required: true },
        { key: "api_token", label: "API Token", type: "secret", required: true },
      ],
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "command",
          title: "Run migration",
          bodyMarkdown: "Connect with `postgres://app:{{db_pass}}@{{db_host}}:5432/prod`.",
          codeBlock: {
            language: "bash",
            content: [
              'curl -H "Authorization: Bearer {{api_token}}" https://example.com/health',
              'export API_KEY="$API_KEY"',
              'password=<YOUR_PASSWORD>',
            ].join("\n"),
          },
        },
      ],
    });

    expect(report.hasBlockers).toBe(false);
    expect(report.blockers).toHaveLength(0);
  });

  it("emits non-blocking soft warnings for private RFC1918 IPs and personal emails", () => {
    const report = scanOperationForSecrets({
      title: "Office NAS Maintenance",
      summary: "Contact alice.ops@company.io if 192.168.1.42 is unreachable (ignore test@example.com).",
      steps: [
        {
          key: "s1",
          position: "a0",
          type: "action",
          title: "Ping gateway",
          bodyMarkdown: "Verify 10.20.30.40 responds.",
        },
      ],
    });

    expect(report.hasBlockers).toBe(false);
    expect(report.hasWarnings).toBe(true);
    const warnRuleIds = new Set(report.warnings.map((w) => w.ruleId));
    expect(warnRuleIds.has("private_rfc1918_ip")).toBe(true);
    expect(warnRuleIds.has("personal_email")).toBe(true);
    // example.com must be skipped
    expect(
      report.warnings.some((w) => w.redactedMatch.includes("example.com"))
    ).toBe(false);
  });

  it("blocks secret variables that contain a defaultValue", () => {
    const report = scanOperationForSecrets({
      title: "Bad Secret Default",
      variables: [
        {
          key: "ssh_pass",
          label: "SSH Pass",
          type: "secret",
          required: true,
          defaultValue: "hardcoded123",
        },
      ],
    });

    expect(report.hasBlockers).toBe(true);
    expect(report.blockers[0]?.ruleId).toBe("secret_variable_default");
  });
});
