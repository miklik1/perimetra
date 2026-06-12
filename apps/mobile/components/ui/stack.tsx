import { View } from "react-native";

// Curated gap scale → Tailwind utility. Lives here because Stack is its only
// consumer; the className→style transform runs in Metro (NativeWind), so the
// behaviour worth testing is "Stack renders with a gap", covered by stack.test.tsx.
const GAP_CLASS = {
  0: "gap-0",
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
  10: "gap-10",
  12: "gap-12",
} as const;

type GapSize = keyof typeof GAP_CLASS;

type StackProps = {
  children?: React.ReactNode;
  className?: string;
  gap?: GapSize;
};

export function Stack({ children, className, gap = 3 }: StackProps) {
  return <View className={`flex flex-col ${GAP_CLASS[gap]} ${className ?? ""}`}>{children}</View>;
}
