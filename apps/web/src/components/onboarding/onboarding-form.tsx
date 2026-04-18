"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { useAccount } from "wagmi";

import type { CompleteOnboardingResponse } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const onboardingFormSchema = z.object({
  displayName: z
    .string()
    .min(2, "Use at least 2 characters")
    .max(40, "Keep it under 40 characters"),
  email: z.union([z.literal(""), z.string().email("Enter a valid email")]),
  bio: z.string().max(500, "Bio is too long").optional(),
  avatarPreset: z.enum(["none", "orbit", "beam"]),
  role: z.enum(["CLIENT", "FREELANCER"], {
    message: "Choose how you will use EscrowFlow",
  }),
});

export type OnboardingFormValues = z.infer<typeof onboardingFormSchema>;

function buildAvatarUrl(
  preset: OnboardingFormValues["avatarPreset"],
  seed: string,
): string | null {
  if (preset === "none") {
    return null;
  }
  const style = preset === "orbit" ? "orbit" : "beam";
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

export function OnboardingForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const seed = address ?? "escrowflow";

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingFormSchema),
    defaultValues: {
      displayName: "",
      email: "",
      bio: "",
      avatarPreset: "orbit",
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const avatarUrl = buildAvatarUrl(values.avatarPreset, seed);
      const res = await fetch("/api/v1/users/me/onboarding", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: values.displayName.trim(),
          email: values.email === "" ? null : values.email,
          bio: values.bio?.trim() ? values.bio.trim() : null,
          avatarUrl,
          role: values.role,
        }),
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      void (raw as CompleteOnboardingResponse);
      setDone(true);
      setTimeout(() => {
        router.replace("/dashboard");
      }, 900);
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setSubmitError(e.message);
        return;
      }
      setSubmitError("Could not save your profile. Try again.");
    }
  });

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Set up your profile</CardTitle>
        <CardDescription>
          Tell us how you plan to use EscrowFlow. You can update these profile
          details later.
        </CardDescription>
      </CardHeader>

      {done ? (
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center dark:border-emerald-900 dark:bg-emerald-950/40"
          role="status"
        >
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
            You are all set. Redirecting to your dashboard...
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="flex flex-col gap-6"
        >
          <div className="space-y-2">
            <Label htmlFor="displayName">Username</Label>
            <Input
              id="displayName"
              autoComplete="username"
              placeholder="e.g. sam_escrow"
              aria-invalid={Boolean(form.formState.errors.displayName)}
              {...form.register("displayName")}
            />
            <FieldError message={form.formState.errors.displayName?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              aria-invalid={Boolean(form.formState.errors.email)}
              {...form.register("email")}
            />
            <FieldError message={form.formState.errors.email?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio (optional)</Label>
            <Textarea
              id="bio"
              placeholder="A short line about what you build or hire for."
              aria-invalid={Boolean(form.formState.errors.bio)}
              {...form.register("bio")}
            />
            <FieldError message={form.formState.errors.bio?.message} />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Avatar placeholder
            </legend>
            <Controller
              control={form.control}
              name="avatarPreset"
              render={({ field }) => (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["none", "No image"],
                      ["orbit", "Orbit"],
                      ["beam", "Beam"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={`flex min-h-14 cursor-pointer items-center justify-center rounded-xl border px-3 py-3 text-center text-sm font-medium transition ${
                        field.value === value
                          ? "border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/50 dark:text-indigo-100"
                          : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600"
                      }`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        value={value}
                        checked={field.value === value}
                        onChange={() => field.onChange(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            />
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              I am joining as
            </legend>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label
                    className={`flex min-h-14 cursor-pointer flex-col gap-1 rounded-xl border px-4 py-4 transition ${
                      field.value === "CLIENT"
                        ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40"
                        : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950"
                    }`}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      checked={field.value === "CLIENT"}
                      onChange={() => field.onChange("CLIENT")}
                    />
                    <span className="font-semibold text-zinc-900 dark:text-white">
                      Client
                    </span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      I hire freelancers and fund milestone escrow.
                    </span>
                  </label>
                  <label
                    className={`flex min-h-14 cursor-pointer flex-col gap-1 rounded-xl border px-4 py-4 transition ${
                      field.value === "FREELANCER"
                        ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40"
                        : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950"
                    }`}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      checked={field.value === "FREELANCER"}
                      onChange={() => field.onChange("FREELANCER")}
                    />
                    <span className="font-semibold text-zinc-900 dark:text-white">
                      Freelancer
                    </span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      I deliver milestones and receive milestone payouts.
                    </span>
                  </label>
                </div>
              )}
            />
            <FieldError message={form.formState.errors.role?.message} />
          </fieldset>

          <FieldError
            message={submitError ?? undefined}
            className="text-center"
          />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Saving…" : "Complete setup"}
          </Button>
        </form>
      )}
    </Card>
  );
}
