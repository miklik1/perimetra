"use client";

import { useMemo } from "react";

import { useTranslations } from "@repo/i18n/web";
import type { Catalog } from "@repo/model";
import { ArrayField } from "@repo/ui/forms/array-field";
import { DisclosureSection } from "@repo/ui/forms/disclosure-section";
import { EnumSelect } from "@repo/ui/forms/enum-select";
import { FieldShell, fieldInputClass } from "@repo/ui/forms/field-shell";
import { Controller, useWatch } from "react-hook-form";

import { blankGeometry, blankPart } from "../lib/draft";
import { ExprField } from "../lib/expr-field";
import { bomCategoryValues, bomUnitValues, type ReleaseEditorForm } from "../lib/section-schemas";
import { EMPTY_SCOPE, type ReleaseValidation } from "../lib/use-release-validation";
import {
  whereGeometry,
  whereGeometryAt,
  whereGeometryCut,
  whereGeometryLength,
  whereGeometryPrefix,
  whereGeometryRepeatCount,
  whereGeometryRepeatVar,
  whereGeometryRotation,
  wherePart,
  wherePartBom,
  wherePartResolveMaterial,
  wherePartResolveRole,
  wherePartResolveSection,
  wherePartWhen,
  type BomSlot,
} from "../lib/where";

interface CatalogOptions {
  /** Unique semantic roles the catalog's components advertise (I5 resolution). */
  roles: string[];
  sectionCodes: string[];
  materialCodes: string[];
}

function catalogOptions(catalog: Catalog | null): CatalogOptions {
  if (!catalog) return { roles: [], sectionCodes: [], materialCodes: [] };
  return {
    roles: [...new Set(catalog.components.flatMap((c) => c.roles))].sort(),
    sectionCodes: catalog.sections.map((s) => s.code),
    materialCodes: catalog.materials.map((m) => m.code),
  };
}

interface PartProps {
  form: ReleaseEditorForm;
  validation: ReleaseValidation;
  options: CatalogOptions;
}

/** Geometry rows don't read the catalog (no role/section/material pickers) — a
 *  narrower prop set than {@link PartProps}. */
interface GeoRowProps {
  form: ReleaseEditorForm;
  validation: ReleaseValidation;
  partPath: string;
  partIndex: number;
  index: number;
}

const AXES = [0, 1, 2] as const;
const AXIS_LABELS = ["x", "y", "z"] as const;
const AT_FIELDS = ["atX", "atY", "atZ"] as const;
const ROT_FIELDS = ["rotX", "rotY", "rotZ"] as const;

/** The geometry-row Expr slots (all string fields on a `GeometryDraft`). */
type GeoExprField =
  | "length"
  | "atX"
  | "atY"
  | "atZ"
  | "rotX"
  | "rotY"
  | "rotZ"
  | "cutLeft"
  | "cutRight"
  | "repeatCount";

function GeometryRow({ form, validation, partPath, partIndex, index }: GeoRowProps) {
  const t = useTranslations("releaseEditor");
  const { control, register } = form;
  const base = `parts.${partIndex}.geometry.${index}` as const;
  const key = (useWatch({ control, name: `${base}.key` }) as string) ?? "";
  const useRotation = useWatch({ control, name: `${base}.useRotation` });
  const useRepeat = useWatch({ control, name: `${base}.useRepeat` });

  const scopeFor = (where: string) => validation.scopes.get(where) ?? EMPTY_SCOPE;
  const defectFor = (where: string) => validation.defectsByWhere.get(where)?.[0]?.message;

  const exprCell = (field: GeoExprField, where: string, label: string) => (
    <FieldShell label={label} error={defectFor(where)}>
      {({ fieldId, describedById }) => (
        <Controller
          control={control}
          name={`${base}.${field}`}
          render={({ field: rhf }) => (
            <ExprField
              id={fieldId}
              describedById={describedById}
              aria-label={label}
              value={(rhf.value as string) ?? ""}
              onChange={rhf.onChange}
              scope={scopeFor(where)}
              defect={defectFor(where)}
            />
          )}
        />
      )}
    </FieldShell>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <FieldShell
          label={t("geometryKey")}
          error={defectFor(whereGeometry(partPath, key))}
          required
        >
          {({ fieldId }) => (
            <input id={fieldId} className={fieldInputClass} {...register(`${base}.key`)} />
          )}
        </FieldShell>
        {exprCell("length", whereGeometryLength(partPath, key), t("geometryLength"))}
      </div>

      <fieldset className="grid grid-cols-3 gap-2">
        <legend className="text-muted-foreground mb-1 text-xs">{t("geometryAt")}</legend>
        {AXES.map((axis) =>
          exprCell(AT_FIELDS[axis], whereGeometryAt(partPath, key, axis), AXIS_LABELS[axis]),
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register(`${base}.useRotation`)} />
        {t("geometryRotation")}
      </label>
      {useRotation ? (
        <div className="grid grid-cols-3 gap-2">
          {AXES.map((axis) =>
            exprCell(
              ROT_FIELDS[axis],
              whereGeometryRotation(partPath, key, axis),
              AXIS_LABELS[axis],
            ),
          )}
        </div>
      ) : null}

      <DisclosureSection title={t("geometryCuts")}>
        <div className="grid grid-cols-2 gap-2">
          {exprCell("cutLeft", whereGeometryCut(partPath, key, "left"), t("cutLeft"))}
          {exprCell("cutRight", whereGeometryCut(partPath, key, "right"), t("cutRight"))}
        </div>
      </DisclosureSection>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" {...register(`${base}.useRepeat`)} />
        {t("geometryRepeat")}
      </label>
      {useRepeat ? (
        <div className="grid grid-cols-2 gap-2">
          {exprCell("repeatCount", whereGeometryRepeatCount(partPath, key), t("repeatCount"))}
          <FieldShell
            label={t("repeatVar")}
            description={t("repeatVarHint")}
            error={defectFor(whereGeometryRepeatVar(partPath, key))}
          >
            {({ fieldId }) => (
              <input id={fieldId} className={fieldInputClass} {...register(`${base}.repeatVar`)} />
            )}
          </FieldShell>
        </div>
      ) : null}
    </div>
  );
}

/** Maps a model BOM slot to its `*Draft` field name (the I-side string field). */
const BOM_FIELDS = {
  quantity: "bomQuantity",
  lengthMm: "bomLengthMm",
  pricePerUnit: "bomPricePerUnit",
  totalPrice: "bomTotalPrice",
} as const satisfies Record<BomSlot, string>;

function PartRow({ form, validation, options, index }: PartProps & { index: number }) {
  const t = useTranslations("releaseEditor");
  const { control, register } = form;
  const base = `parts.${index}` as const;
  const path = (useWatch({ control, name: `${base}.path` }) as string) ?? "";

  const scopeFor = (where: string) => validation.scopes.get(where) ?? EMPTY_SCOPE;
  const defectFor = (where: string) => validation.defectsByWhere.get(where)?.[0]?.message;
  const hasDefectUnder = (prefix: string) =>
    validation.defects.some((d) => "where" in d && d.where.startsWith(prefix));

  const resolveExpr = (
    field: "section" | "material" | "when",
    where: string,
    label: string,
    codeSuggestions?: readonly string[],
    description?: string,
  ) => (
    <FieldShell label={label} description={description} error={defectFor(where)}>
      {({ fieldId, describedById }) => (
        <Controller
          control={control}
          name={`${base}.${field}`}
          render={({ field: rhf }) => (
            <ExprField
              id={fieldId}
              describedById={describedById}
              aria-label={label}
              value={(rhf.value as string) ?? ""}
              onChange={rhf.onChange}
              scope={scopeFor(where)}
              defect={defectFor(where)}
              codeSuggestions={codeSuggestions}
            />
          )}
        />
      )}
    </FieldShell>
  );

  const bomExpr = (slot: BomSlot, required = false) => {
    const where = wherePartBom(path, slot);
    return (
      <FieldShell label={t(`bom_${slot}`)} error={defectFor(where)} required={required}>
        {({ fieldId, describedById }) => (
          <Controller
            control={control}
            name={`${base}.${BOM_FIELDS[slot]}`}
            render={({ field: rhf }) => (
              <ExprField
                id={fieldId}
                describedById={describedById}
                aria-label={t(`bom_${slot}`)}
                value={(rhf.value as string) ?? ""}
                onChange={rhf.onChange}
                scope={scopeFor(where)}
                defect={defectFor(where)}
              />
            )}
          />
        )}
      </FieldShell>
    );
  };

  return (
    <DisclosureSection
      title={path === "" ? t("partUntitled") : path}
      defaultOpen={path === ""}
      badge={
        hasDefectUnder(wherePart(path)) ? <span className="text-destructive">!</span> : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <FieldShell
            label={t("partPath")}
            description={t("partPathHint")}
            error={defectFor(wherePart(path))}
            required
          >
            {({ fieldId }) => (
              <input id={fieldId} className={fieldInputClass} {...register(`${base}.path`)} />
            )}
          </FieldShell>
          <FieldShell label={t("partName")} required>
            {({ fieldId }) => (
              <input id={fieldId} className={fieldInputClass} {...register(`${base}.name`)} />
            )}
          </FieldShell>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <FieldShell
            label={t("partRole")}
            description={t("partRoleHint")}
            error={defectFor(wherePartResolveRole(path))}
            required
          >
            {({ fieldId }) => (
              <>
                <input
                  id={fieldId}
                  className={fieldInputClass}
                  list={`${fieldId}-roles`}
                  {...register(`${base}.role`)}
                />
                <datalist id={`${fieldId}-roles`}>
                  {options.roles.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
              </>
            )}
          </FieldShell>
          <FieldShell label={t("bomCategory")}>
            {({ fieldId }) => (
              <Controller
                control={control}
                name={`${base}.bomCategory`}
                render={({ field }) => (
                  <EnumSelect
                    id={fieldId}
                    value={field.value}
                    onChange={field.onChange}
                    options={bomCategoryValues.map((v) => ({ value: v }))}
                  />
                )}
              />
            )}
          </FieldShell>
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <FieldShell label={t("bomUnit")}>
            {({ fieldId }) => (
              <Controller
                control={control}
                name={`${base}.bomUnit`}
                render={({ field }) => (
                  <EnumSelect
                    id={fieldId}
                    value={field.value}
                    onChange={field.onChange}
                    options={bomUnitValues.map((v) => ({ value: v }))}
                  />
                )}
              />
            )}
          </FieldShell>
          {bomExpr("quantity", true)}
        </div>

        <DisclosureSection title={t("partResolve")}>
          <div className="flex flex-col gap-2">
            {resolveExpr(
              "section",
              wherePartResolveSection(path),
              t("partSection"),
              options.sectionCodes,
              t("partSectionHint"),
            )}
            {resolveExpr(
              "material",
              wherePartResolveMaterial(path),
              t("partMaterial"),
              options.materialCodes,
              t("partMaterialHint"),
            )}
            {resolveExpr("when", wherePartWhen(path), t("partWhen"), undefined, t("partWhenHint"))}
          </div>
        </DisclosureSection>

        <DisclosureSection title={t("bomExtras")}>
          <div className="flex flex-col gap-2">
            {bomExpr("lengthMm")}
            {bomExpr("pricePerUnit")}
            {bomExpr("totalPrice")}
          </div>
        </DisclosureSection>

        <DisclosureSection
          title={t("geometry")}
          badge={
            hasDefectUnder(whereGeometryPrefix(path)) ? (
              <span className="text-destructive">!</span>
            ) : undefined
          }
        >
          <ArrayField
            control={control}
            name={`parts.${index}.geometry`}
            addLabel={t("addGeometry")}
            emptyLabel={t("geometryEmpty")}
            makeDefault={blankGeometry}
          >
            {({ index: gIndex }) => (
              <GeometryRow
                form={form}
                validation={validation}
                partPath={path}
                partIndex={index}
                index={gIndex}
              />
            )}
          </ArrayField>
        </DisclosureSection>
      </div>
    </DisclosureSection>
  );
}

export function PartsWorkbench({
  form,
  validation,
  catalog,
}: {
  form: ReleaseEditorForm;
  validation: ReleaseValidation;
  catalog: Catalog | null;
}) {
  const t = useTranslations("releaseEditor");
  const options = useMemo(() => catalogOptions(catalog), [catalog]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t("partsHint")}</p>
      {catalog === null ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">{t("partsNoCatalog")}</p>
      ) : null}
      <ArrayField
        control={form.control}
        name="parts"
        addLabel={t("addPart")}
        emptyLabel={t("partsEmpty")}
        makeDefault={blankPart}
      >
        {({ index }) => (
          <PartRow form={form} validation={validation} options={options} index={index} />
        )}
      </ArrayField>
    </div>
  );
}
