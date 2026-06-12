import { Pressable, Text } from "react-native";

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  className?: string;
};

export function Button({ label, onPress, variant = "primary", disabled, className }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-lg px-6 py-3 ${
        variant === "primary" ? "bg-primary" : "bg-secondary"
      } ${disabled ? "opacity-50" : ""} ${className ?? ""}`}
    >
      <Text
        className={`text-center font-semibold ${
          variant === "primary" ? "text-primary-foreground" : "text-secondary-foreground"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
