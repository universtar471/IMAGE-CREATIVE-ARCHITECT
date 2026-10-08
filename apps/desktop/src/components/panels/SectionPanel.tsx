import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** Collapsible property-panel section (native <details> keeps state cheap and accessible). */
export function SectionPanel({
  title,
  defaultOpen = true,
  aside,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>
        <ChevronRight size={14} className="chev" />
        {title}
        <span className="spacer" />
        {aside}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
