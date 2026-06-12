import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { TextInput } from "react-native";

import { invalidateKeys, keys } from "@repo/api";
import { useMutation, useQueryClient, useUsersQueries } from "@repo/api/react";
import { createUserSchema, type CreateUserInput } from "@repo/validators";

import { toast } from "../lib/toast";
import { Button, Stack, Text } from "./ui";

/**
 * Create-user form (ADR 0009), mobile half. Same `createUserSchema`
 * (@repo/validators) as web drives validation and the `create` mutation; only
 * the fields differ (RN `TextInput` via RHF `Controller`, since `register`'s DOM
 * refs don't exist here). Invalidates the users list on success — invalidation
 * lives in the component, which owns the QueryClient.
 */
export function CreateUserForm() {
  const usersQueries = useUsersQueries();
  const queryClient = useQueryClient();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "" },
  });

  const mutation = useMutation({
    ...usersQueries.create(),
    // Toast on settle (ADR 0027) — the demo wiring of the cross-platform queue
    // on mobile, mirroring web's create-user-form. The store + `toast`
    // singleton are shared; only the `<Toaster>` render differs by platform.
    onSuccess: () => {
      void invalidateKeys(queryClient, [keys.users.lists()]);
      reset();
      toast.success("User created");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const fieldClass = "border-border bg-background text-foreground rounded-md border px-3 py-2";

  return (
    <Stack gap={3} className="w-full">
      <Text variant="heading">New user</Text>

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="Name"
            autoCapitalize="words"
            className={fieldClass}
          />
        )}
      />
      {errors.name && (
        <Text variant="caption" className="text-destructive">
          {errors.name.message}
        </Text>
      )}

      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextInput
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            className={fieldClass}
          />
        )}
      />
      {errors.email && (
        <Text variant="caption" className="text-destructive">
          {errors.email.message}
        </Text>
      )}

      <Button
        label={mutation.isPending ? "Creating…" : "Create user"}
        disabled={mutation.isPending}
        onPress={handleSubmit((values) => mutation.mutate(values))}
      />

      {mutation.isError && (
        <Text variant="caption" className="text-destructive">
          {mutation.error.message}
        </Text>
      )}
      {mutation.isSuccess && <Text variant="caption">Created.</Text>}
    </Stack>
  );
}
