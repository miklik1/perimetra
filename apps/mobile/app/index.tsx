import { Alert, ScrollView, useColorScheme } from "react-native";

import { useFlag } from "@repo/flags/native";
import { Link } from "@repo/navigation";

import { CreateUserForm } from "../components/create-user-form";
import { ThemeToggle } from "../components/theme-toggle";
import { Button, SafeArea, Text } from "../components/ui";

export default function Home() {
  // RN's built-in hook (NativeWind's own `useColorScheme` is deprecated in v5).
  // With `userInterfaceStyle: "automatic"` (app.config.ts), this tracks the OS
  // scheme — which the ThemeToggle can now override via NativeWind (ADR 0010).
  const scheme = useColorScheme() ?? "light";

  // Feature-flag read (ADR 0028) — the mobile mirror of web's `getFlag`-gated
  // section. Default `true` (registry), so a key-less run shows it; toggling
  // `example-flag` OFF in PostHog hides it — the end-to-end native proof.
  const showDemo = useFlag("example-flag");

  return (
    <SafeArea className="bg-background flex-1">
      <ScrollView contentContainerClassName="items-center justify-center gap-4 p-6">
        <Text variant="heading">Mobile</Text>
        <Text variant="caption">Color scheme: {scheme}</Text>
        <Button label="Hello" onPress={() => Alert.alert("Hello from mobile!")} />
        {showDemo ? <Text variant="caption">Flag-gated demo (example-flag)</Text> : null}
        <ThemeToggle />
        <Link to={{ route: "users" }}>
          <Text>Go to users</Text>
        </Link>
        <CreateUserForm />
      </ScrollView>
    </SafeArea>
  );
}
