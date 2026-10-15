import {
  EVIDENCE_STATUSES,
  SITE_BOUNDARY_KINDS,
  SITE_SIDES,
  siteForEditing,
  type ProjectDNA,
  type SiteBoundaryKind,
  type SiteExtension,
  type SiteSide,
} from "@arch/domain";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { SelectField } from "../../components/panels/fields";
import { useT } from "../../i18n";
import { selectReadOnly, useStudio } from "../../app/store";
import { editSiteSide } from "./siteEdit";

/**
 * Site adjacency editor (ADR-034, SRS §5.2): four sides, each with a boundary kind and an
 * evidence status, left/right as seen when facing the front facade. Replaces the ADR-028
 * left/right/corner toggles and writes both `site` and the synced `context.siteTopology`.
 */
export function SiteAdjacencyEditor() {
  const t = useT();
  const editDna = useStudio((state) => state.editDna);
  const workspace = useStudio((state) => state.workspace!);
  const dna = workspace.draftDna as ProjectDNA;
  const readOnly = useStudio(selectReadOnly);
  const disabled = readOnly || dna.locks.context;
  const site = siteForEditing(dna, workspace.project.projectType);
  const kindOptions = SITE_BOUNDARY_KINDS.map((kind) => ({
    value: kind,
    label: t(`site.kinds.${kind}`),
  }));
  const statusOptions = EVIDENCE_STATUSES.map((status) => ({
    value: status,
    label: t(`site.evidence.${status}`),
  }));

  return (
    <SectionPanel title={t("site.title")}>
      <div className="site-editor" data-testid="site-adjacency-editor">
        <SitePlanDiagram site={site} />
        <div className="site-editor-fields">
          <p className="field-hint">{t("site.convention")}</p>
          {!dna.site && <p className="field-hint">{t("site.derived")}</p>}
          {SITE_SIDES.map((side) => (
            <div className="field-row" key={side} data-testid={`site-side-${side}`}>
              <SelectField
                label={t(`site.sides.${side}`)}
                value={site[side].kind}
                allowEmpty={false}
                disabled={disabled}
                options={kindOptions}
                onChange={(kind) =>
                  kind && editSiteSide(editDna, dna, side, { kind }, workspace.project.projectType)
                }
              />
              <SelectField
                label={t(`site.evidenceFor.${side}`)}
                value={site[side].evidence.status}
                allowEmpty={false}
                disabled={disabled}
                options={statusOptions}
                onChange={(status) =>
                  status &&
                  editSiteSide(editDna, dna, side, { status }, workspace.project.projectType)
                }
              />
            </div>
          ))}
        </div>
      </div>
    </SectionPanel>
  );
}

const KIND_FILL: Record<SiteBoundaryKind, string> = {
  attached_building: "#b6c5ac",
  street: "#9aa4b1",
  open_space: "#cfe3bf",
  boundary_wall: "#e9e2d4",
  unknown: "none",
};

/** Band outside the plot for each side: x, y, width, height. */
const BAND: Record<SiteSide, [number, number, number, number]> = {
  rear: [56, 6, 88, 22],
  left: [22, 32, 30, 84],
  right: [148, 32, 30, 84],
  front: [56, 120, 88, 22],
};

/** The plot edge of each side, where a boundary wall is drawn. */
const EDGE: Record<SiteSide, string> = {
  rear: "M56 30h88",
  left: "M54 32v84",
  right: "M146 32v84",
  front: "M56 118h88",
};

const LABEL_AT: Record<SiteSide, [number, number]> = {
  rear: [100, 21],
  left: [37, 77],
  right: [163, 77],
  front: [100, 135],
};

/** Small plan of the plot, front facade at the bottom, viewer below it. */
function SitePlanDiagram({ site }: { site: SiteExtension }) {
  const t = useT();
  return (
    <svg
      className="site-plan"
      viewBox="0 0 200 172"
      role="img"
      aria-label={t("site.diagram")}
      data-testid="site-plan"
      data-front={site.front.kind}
      data-left={site.left.kind}
      data-right={site.right.kind}
      data-rear={site.rear.kind}
    >
      <title>{t("site.diagram")}</title>
      {SITE_SIDES.map((side) => {
        const [x, y, width, height] = BAND[side];
        const kind = site[side].kind;
        return (
          <g key={side} className={`site-plan-side site-plan-${kind}`}>
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx="2"
              fill={KIND_FILL[kind]}
              stroke={kind === "unknown" ? "#94a3b8" : "none"}
              strokeDasharray={kind === "unknown" ? "4 3" : undefined}
            />
            {kind === "boundary_wall" && (
              <path d={EDGE[side]} stroke="#6b5b4b" strokeWidth="4" strokeLinecap="square" />
            )}
            <text
              x={LABEL_AT[side][0]}
              y={LABEL_AT[side][1]}
              textAnchor="middle"
              fontSize="8"
              fill="#1e293b"
              transform={
                side === "left" || side === "right"
                  ? `rotate(-90 ${LABEL_AT[side][0]} ${LABEL_AT[side][1]})`
                  : undefined
              }
            >
              {t(`site.short.${side}`)}
            </text>
          </g>
        );
      })}
      <rect x="56" y="32" width="88" height="84" rx="2" fill="#f1f5f9" stroke="#64748b" />
      <rect x="70" y="46" width="60" height="58" rx="2" fill="#eadab9" stroke="#8c7962" />
      <text x="100" y="78" textAnchor="middle" fontSize="8" fill="#1e293b">
        {t("site.building")}
      </text>
      <path d="M100 166v-18m-5 6 5-6 5 6" fill="none" stroke="#f59e0b" strokeWidth="2" />
      <text x="112" y="164" fontSize="8" fill="currentColor">
        {t("site.viewer")}
      </text>
    </svg>
  );
}
