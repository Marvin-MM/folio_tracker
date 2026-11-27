"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Strictly allows `https:`, `http:`, and `mailto:` links only.
 * Blocks `javascript:`, `data:`, `vbscript:`, and protocol-relative `//` URLs.
 */
export function sanitizeMarkdownUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("//")) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 className="mt-3 mb-1 text-xs font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="mt-2.5 mb-1 text-xs font-medium text-foreground first:mt-0">
      {children}
    </h5>
  ),
  p: ({ children }) => (
    <p className="mb-2 text-xs leading-relaxed text-foreground/90 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground/90 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-foreground/90 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-3 text-xs italic text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  code: ({ className, children }) => {
    const isBlock = Boolean(className && className.includes("language-"));
    if (isBlock) {
      return (
        <code className="font-mono text-[11px] leading-relaxed text-foreground">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md border border-border bg-muted p-2.5 font-mono text-[11px] leading-relaxed text-foreground last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mb-2 w-full overflow-x-auto rounded-md border border-border last:mb-0">
      <table className="w-full border-collapse text-left text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border bg-muted text-[11px] font-medium text-muted-foreground">
      {children}
    </thead>
  ),
  th: ({ children }) => <th className="px-2.5 py-1.5 font-medium">{children}</th>,
  td: ({ children }) => (
    <td className="border-t border-border px-2.5 py-1.5 text-foreground/90">
      {children}
    </td>
  ),
  a: ({ href, children }) => {
    const safeHref = href ? sanitizeMarkdownUrl(href) : "";
    if (!safeHref) {
      return <span className="text-muted-foreground">{children}</span>;
    }
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-collab underline decoration-collab/50 underline-offset-2 transition-colors hover:decoration-collab"
      >
        {children}
      </a>
    );
  },
  // Block external image pixels to honor Folio's strict CSP and prevent tracking.
  img: ({ alt }) => (
    <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      [image{alt ? `: ${alt}` : ""}]
    </span>
  ),
};

interface SafeMarkdownProps {
  content: string;
  className?: string;
}

export function SafeMarkdown({ content, className }: SafeMarkdownProps) {
  if (!content.trim()) return null;

  return (
    <div className={cn("min-w-0 break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml={true}
        urlTransform={sanitizeMarkdownUrl}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
