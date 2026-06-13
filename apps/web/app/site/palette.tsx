"use client";

import { useTranslations } from "@repo/i18n/web";
import { Button, cn } from "@repo/ui";

import type { ConfigurableProduct } from "../configurator/products";
import type { InstanceUi } from "./derive";

/**
 * The placement palette: add an instance of any vendor release, then select or
 * remove placed instances. The release list is the same generated catalogue the
 * configurator offers — a new product family appears here with no app change.
 */
export interface PaletteProps {
  products: ConfigurableProduct[];
  instances: InstanceUi[];
  selectedId?: string;
  onAdd: (productIndex: number) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

export function Palette({
  products,
  instances,
  selectedId,
  onAdd,
  onSelect,
  onRemove,
}: PaletteProps) {
  const t = useTranslations("site");
  return (
    <section className="border-border flex flex-col gap-3 rounded-md border p-4 text-sm">
      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">{t("add")}</h2>
        <div className="flex flex-wrap gap-2">
          {products.map((p, i) => (
            <Button key={p.release.id} variant="outline" size="sm" onClick={() => onAdd(i)}>
              + {p.release.modelId}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">{t("instances", { count: instances.length })}</h2>
        {instances.length === 0 ? (
          <p className="text-muted-foreground">{t("noInstances")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {instances.map((instance) => (
              <li key={instance.instanceId} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelect(instance.instanceId)}
                  aria-current={instance.instanceId === selectedId ? "true" : undefined}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-left",
                    instance.instanceId === selectedId
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full",
                      instance.result?.isValid ? "bg-muted-foreground" : "bg-destructive",
                    )}
                  />
                  <span className="flex-1 truncate">
                    {instance.product.release.modelId} · {instance.instanceId}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(instance.instanceId)}
                  aria-label={t("removeInstance", { instance: instance.instanceId })}
                  className="text-muted-foreground hover:text-destructive rounded px-1.5"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
