import { SafeAreaView } from "react-native-safe-area-context";

type SafeAreaProps = {
  children: React.ReactNode;
  className?: string;
};

export function SafeArea({ children, className }: SafeAreaProps) {
  return <SafeAreaView className={className}>{children}</SafeAreaView>;
}
