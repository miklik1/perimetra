import { Text as RNText } from "react-native";

type TextProps = {
  children: React.ReactNode;
  className?: string;
  variant?: "body" | "heading" | "caption";
};

const variantClasses = {
  body: "text-base text-foreground",
  heading: "text-2xl font-bold text-foreground",
  caption: "text-sm text-muted-foreground",
};

export function Text({ children, className, variant = "body" }: TextProps) {
  return <RNText className={`${variantClasses[variant]} ${className ?? ""}`}>{children}</RNText>;
}
