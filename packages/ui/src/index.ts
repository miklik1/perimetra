export { Button, buttonVariants } from "./components/ui/button";
export { Toast, ToastViewport, toastVariants, type ToastProps } from "./components/ui/toast";
// Perimetra brand kit (ADR 0072) — token-driven premium-editorial primitives.
export { Panel, panelVariants } from "./components/ui/panel";
export { Badge, badgeVariants } from "./components/ui/badge";
export { DisplayLabel } from "./components/ui/display-label";
export { StepNav, StepProgress } from "./components/ui/step-nav";
export { IconButton, IconCluster, iconButtonVariants } from "./components/ui/icon-button";
export { FieldError, type FieldErrorProps } from "./components/ui/field-error";

// Perimetra kit expansion (ADR 0111) — the full reference-grade component
// vocabulary, built on the Vercel composition patterns (compound components +
// React.use() context, explicit variants over boolean modes, radix-ui behaviour).
export { SegmentedNav, SegmentedNavItem } from "./components/ui/segmented-nav";
export { StatCard } from "./components/ui/stat-card";
export { Field, Input, Textarea } from "./components/ui/field";
export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./components/ui/select";
export { Switch, Checkbox } from "./components/ui/switch";
export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "./components/ui/tooltip";
export { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "./components/ui/popover";
export { Pager } from "./components/ui/pager";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  sheetVariants,
} from "./components/ui/dialog";
export { Skeleton, Spinner, Separator } from "./components/ui/skeleton";
export { EmptyState } from "./components/ui/empty-state";

// Design-canvas adoption (ADR 0114) — the export's own vocabulary, ported
// verbatim. See design/README.md §9.
export { Icon, ICON_PATHS, type IconName } from "./components/ui/icon";
export { Alert, alertVariants, type AlertTone } from "./components/ui/alert";
export { KeyValueList } from "./components/ui/key-value-list";
export { SelectableCard } from "./components/ui/selectable-card";
export { FadeScrollArea } from "./components/ui/fade-scroll-area";
export { StickyActionBar } from "./components/ui/sticky-action-bar";
export { SkeletonText } from "./components/ui/skeleton-text";

export { cn } from "./lib/utils";
