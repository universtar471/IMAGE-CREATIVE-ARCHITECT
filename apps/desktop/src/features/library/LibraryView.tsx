import { Images, Search } from "lucide-react";
import { AssetStatusSchema, type AssetStatus } from "@arch/domain";
import { useStudio } from "../../app/store";
import { EmptyState } from "../../components/common/states";
import { useT } from "../../i18n";
import { AssetThumbnail } from "../assets/AssetThumbnail";
import {
  assetName,
  filterLibraryAssets,
  libraryStateFor,
  useLibrary,
  type LibraryKind,
} from "./library";

const KINDS: readonly LibraryKind[] = ["all", "generated", "imported"];

/** "Ảnh của tôi" center view: a full-size grid with search, filters and multi-select. */
export function LibraryView() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const assets = useStudio((s) => s.workspace!.assets);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const selectAsset = useStudio((s) => s.selectAsset);
  const library = useLibrary();
  const { checkedIds, filters } = libraryStateFor(library, projectId);
  const t = useT();
  const visible = filterLibraryAssets(assets, filters);

  return (
    <main className="center" aria-label={t("library.label")} data-testid="library-view">
      <div className="library-toolbar" role="search">
        <div className="library-search">
          <Search size={14} />
          <input
            className="input"
            type="search"
            aria-label={t("library.filterName")}
            placeholder={t("library.filterNamePlaceholder")}
            value={filters.name}
            onChange={(e) => library.setFilters(projectId, { name: e.target.value })}
          />
        </div>
        <select
          className="select"
          aria-label={t("library.kind")}
          value={filters.kind}
          onChange={(e) => library.setFilters(projectId, { kind: e.target.value as LibraryKind })}
        >
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(
                kind === "all"
                  ? "library.kindAll"
                  : kind === "generated"
                    ? "library.kindGenerated"
                    : "library.kindImported",
              )}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label={t("library.status")}
          value={filters.status}
          onChange={(e) =>
            library.setFilters(projectId, { status: e.target.value as AssetStatus | "all" })
          }
        >
          <option value="all">{t("library.statusAll")}</option>
          {AssetStatusSchema.options.map((status) => (
            <option key={status} value={status}>
              {status === "ready" ? t("assets.ready") : t("assets.missing")}
            </option>
          ))}
        </select>
        <span className="field-hint" data-testid="library-count">
          {t("library.count", { shown: visible.length, total: assets.length })}
        </span>
        <span className="spacer" />
        {checkedIds.length > 0 && (
          <span className="badge badge-info">
            {t("library.selected", { count: checkedIds.length })}
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={visible.length === 0}
          onClick={() =>
            library.setChecked(
              projectId,
              visible.map((asset) => asset.id),
            )
          }
        >
          {t("library.selectVisible")}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={checkedIds.length === 0}
          onClick={() => library.setChecked(projectId, [])}
        >
          {t("library.clearSelection")}
        </button>
      </div>
      <div className="center-body library-body">
        {assets.length === 0 ? (
          <EmptyState icon={<Images size={28} />} title={t("library.label")}>
            {t("library.empty")}
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState title={t("library.noMatch")}>{t("assets.changeFilter")}</EmptyState>
        ) : (
          <div className="library-grid" role="listbox" aria-label={t("library.label")}>
            {visible.map((asset) => (
              <div
                key={asset.id}
                className={`library-tile ${checkedIds.includes(asset.id) ? "is-checked" : ""}`}
                data-asset={asset.id}
              >
                <input
                  type="checkbox"
                  className="library-check"
                  aria-label={t("library.selectImage", { name: assetName(asset) })}
                  checked={checkedIds.includes(asset.id)}
                  onChange={() => library.toggle(projectId, asset.id)}
                />
                <AssetThumbnail
                  asset={asset}
                  selected={asset.id === selectedId}
                  onSelect={selectAsset}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
