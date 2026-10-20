import { useState } from "react";
import { Layers } from "lucide-react";
import {
  IMAGE_RECIPES,
  planRecipe,
  type ImageRecipe,
  type PlannedVariant,
  type ProjectDNA,
} from "@arch/domain";
import { useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { useLocale, useT } from "../../i18n";

/**
 * Image recipes (ADR-042): pick a recipe, untick variants you do not want, then run them all
 * behind one spend confirm. Each variant is the current chips plus the variant's presets.
 */
export function RecipeSection({
  disabledReason,
  running,
  outputCount,
  onRun,
}: {
  disabledReason: string | null;
  running: boolean;
  outputCount: number;
  onRun: (plans: PlannedVariant[]) => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const ws = useStudio((s) => s.workspace!);
  const [recipe, setRecipe] = useState<ImageRecipe | null>(null);
  const [off, setOff] = useState<string[]>([]);

  const label = (item: { labelVi: string; labelEn: string }) =>
    locale === "vi" ? item.labelVi : item.labelEn;
  const base = { ...(ws.shotIntent ?? {}), projectType: ws.project.projectType };
  const plans = recipe
    ? planRecipe(
        recipe,
        base,
        ws.draftDna as ProjectDNA,
        recipe.variants.filter((v) => !off.includes(v.id)).map((v) => v.id),
      )
    : [];
  const fitting = recipe
    ? new Set(planRecipe(recipe, base, ws.draftDna as ProjectDNA).map((p) => p.variant.id))
    : new Set<string>();

  return (
    <SectionPanel title={t("recipes.title")} defaultOpen={false}>
      <div className="preset-options" role="group" aria-label={t("recipes.title")}>
        {IMAGE_RECIPES.map((r) => (
          <button
            key={r.id}
            type="button"
            className="chip"
            aria-pressed={recipe?.id === r.id}
            title={locale === "vi" ? r.hintVi : r.hintEn}
            onClick={() => {
              setRecipe(recipe?.id === r.id ? null : r);
              setOff([]);
            }}
          >
            {label(r)}
          </button>
        ))}
      </div>
      {recipe && (
        <>
          <span className="field-hint">{locale === "vi" ? recipe.hintVi : recipe.hintEn}</span>
          <ul className="recipe-variants" aria-label={t("recipes.variants")}>
            {recipe.variants.map((v) => (
              <li key={v.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!off.includes(v.id) && fitting.has(v.id)}
                    disabled={!fitting.has(v.id)}
                    onChange={(e) =>
                      setOff((o) => (e.target.checked ? o.filter((x) => x !== v.id) : [...o, v.id]))
                    }
                  />{" "}
                  {label(v)}
                  {!fitting.has(v.id) && (
                    <span className="field-hint"> — {t("recipes.notForShot")}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-primary btn-wrap"
            disabled={running || disabledReason !== null || plans.length === 0}
            data-testid="recipe-run"
            onClick={() => onRun(plans)}
          >
            <Layers size={14} />{" "}
            {t("recipes.run", { count: plans.length, images: plans.length * outputCount })}
          </button>
          {disabledReason && <span className="field-hint">{disabledReason}</span>}
          <span className="field-hint">{t("recipes.costNote")}</span>
        </>
      )}
    </SectionPanel>
  );
}
