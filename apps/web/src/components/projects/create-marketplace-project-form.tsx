"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import type { CreateMarketplaceProjectRequest } from "@escrowflow/types";

import {
  ApiRequestError,
  readJsonOrEmpty,
  type ApiErrorJson,
} from "@/lib/api/client-error";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const milestoneSchema = z.object({
  title: z.string().trim().min(2, "Use at least 2 characters").max(120),
  description: z.string().trim().max(5000).optional(),
  amountWei: z
    .string()
    .regex(/^\d+$/, "Use integer smallest units (no decimals)")
    .refine((v) => {
      try {
        return BigInt(v) > 0n;
      } catch {
        return false;
      }
    }, "Amount must be greater than zero"),
  dueAtLocal: z.string().min(1, "Deadline is required"),
});

const marketplaceProjectSchema = z.object({
  title: z.string().trim().min(3, "Use at least 3 characters").max(120),
  description: z.string().trim().max(10000).optional(),
  milestones: z.array(milestoneSchema).min(1, "Add at least one milestone").max(50),
  chainId: z
    .union([z.literal(""), z.string().regex(/^\d+$/, "Chain id must be numeric")])
    .optional(),
  escrowContractAddress: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^0x[a-fA-F0-9]{40}$/.test(v), "Invalid escrow contract address"),
  onChainProjectId: z
    .union([z.literal(""), z.string().regex(/^\d+$/, "On-chain project id must be numeric")])
    .optional(),
  paymentTokenAddress: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^0x[a-fA-F0-9]{40}$/.test(v), "Invalid token address"),
});

type FormValues = z.infer<typeof marketplaceProjectSchema>;

const emptyMilestone: FormValues["milestones"][number] = {
  title: "",
  description: "",
  amountWei: "",
  dueAtLocal: "",
};

const DEFAULT_CHAIN_ID = process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID?.trim() ?? "";
const DEFAULT_ESCROW_ADDRESS =
  process.env.NEXT_PUBLIC_DEFAULT_ESCROW_REGISTRY_ADDRESS?.trim() ?? "";
const DEFAULT_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_DEFAULT_PAYMENT_TOKEN_ADDRESS?.trim() ?? "";

function parseLocalDateTimeToIso(localDateTime: string): string {
  const date = new Date(localDateTime);
  if (Number.isNaN(date.getTime())) {
    throw new Error("INVALID_MILESTONE_DUE_DATE");
  }
  return date.toISOString();
}

export function CreateMarketplaceProjectForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [agreementFile, setAgreementFile] = useState<File | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(marketplaceProjectSchema),
    defaultValues: {
      title: "",
      description: "",
      chainId: DEFAULT_CHAIN_ID,
      escrowContractAddress: DEFAULT_ESCROW_ADDRESS,
      onChainProjectId: "",
      paymentTokenAddress: DEFAULT_TOKEN_ADDRESS,
      milestones: [emptyMilestone],
    },
  });

  const milestones = useWatch({ control: form.control, name: "milestones" });
  const milestoneArray = useFieldArray({ control: form.control, name: "milestones" });

  const totalMilestoneAmount = (milestones ?? []).reduce((acc, m) => {
    if (!m?.amountWei || !/^\d+$/.test(m.amountWei)) {
      return acc;
    }
    try {
      return acc + BigInt(m.amountWei);
    } catch {
      return acc;
    }
  }, 0n);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const milestonesPayload = values.milestones.map((m) => ({
        title: m.title.trim(),
        description: m.description?.trim() ? m.description.trim() : null,
        amountWei: m.amountWei,
        dueAt: parseLocalDateTimeToIso(m.dueAtLocal),
      }));

      const payload: CreateMarketplaceProjectRequest = {
        title: values.title.trim(),
        description: values.description?.trim() ? values.description.trim() : null,
        milestones: milestonesPayload,
        chainId: values.chainId ? Number(values.chainId) : null,
        escrowContractAddress: values.escrowContractAddress
          ? values.escrowContractAddress.trim()
          : null,
        onChainProjectId: values.onChainProjectId ? values.onChainProjectId : null,
        paymentTokenAddress: values.paymentTokenAddress
          ? values.paymentTokenAddress.trim()
          : null,
      };

      if (agreementFile) {
        const buffer = await agreementFile.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 1) {
          binary += String.fromCharCode(bytes[i]!);
        }
        const fileBase64 = btoa(binary);
        payload.agreement = {
          mode: "file",
          fileName: agreementFile.name,
          mimeType: agreementFile.type || "application/octet-stream",
          fileBase64,
        };
      }

      const res = await fetch("/api/v1/projects/marketplace", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await readJsonOrEmpty(res);
      if (!res.ok) {
        throw new ApiRequestError(res.status, raw as ApiErrorJson);
      }
      const projectId = (raw as { project?: { id?: string } }).project?.id;
      if (!projectId) {
        throw new Error("PROJECT_CREATE_RESPONSE_INVALID");
      }
      router.replace(`/projects/${projectId}`);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setSubmitError(error.message);
        return;
      }
      setSubmitError("Could not post project. Please try again.");
    }
  });

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Post to marketplace</CardTitle>
        <CardDescription>
          Publish an OPEN project visible to freelancers. After you accept an applicant, escrow
          funding begins as usual.
        </CardDescription>
      </CardHeader>
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="flex flex-col gap-5 px-4 pb-6 sm:px-6"
      >
        <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 sm:p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Marketplace listing</p>
          <p className="mt-1 text-xs text-zinc-400">
            Publish a clear scope so qualified freelancers can apply quickly.
          </p>
        </section>

        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" {...form.register("title")} aria-invalid={Boolean(form.formState.errors.title)} />
          <FieldError message={form.formState.errors.title?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" rows={4} {...form.register("description")} />
          <FieldError message={form.formState.errors.description?.message} />
        </div>

        <section className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-3 sm:p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">On-chain defaults</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chainId">Chain id (optional)</Label>
              <Input id="chainId" inputMode="numeric" {...form.register("chainId")} />
              <FieldError message={form.formState.errors.chainId?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentTokenAddress">Payment token (optional)</Label>
              <Input id="paymentTokenAddress" placeholder="0x..." {...form.register("paymentTokenAddress")} />
              <FieldError message={form.formState.errors.paymentTokenAddress?.message} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="escrowContractAddress">Escrow registry (optional)</Label>
              <Input id="escrowContractAddress" placeholder="0x..." {...form.register("escrowContractAddress")} />
              <FieldError message={form.formState.errors.escrowContractAddress?.message} />
            </div>
          </div>
        </section>

        <div className="space-y-2">
          <Label>Agreement file (optional)</Label>
          <Input
            type="file"
            accept=".pdf,.md,.txt,image/*"
            onChange={(e) => setAgreementFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-100">Milestones</p>
              <p className="text-xs text-zinc-400">
                Total: {totalMilestoneAmount.toLocaleString("en-US")} wei (smallest units)
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => milestoneArray.append({ ...emptyMilestone })}
            >
              Add milestone
            </Button>
          </div>
          {milestoneArray.fields.map((field, index) => (
            <div
              key={field.id}
              className="space-y-3 rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-700/90"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-100">
                  Milestone {index + 1}
                </p>
                {milestoneArray.fields.length > 1 ? (
                  <Button type="button" variant="ghost" size="sm" className="w-full sm:w-auto" onClick={() => milestoneArray.remove(index)}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input {...form.register(`milestones.${index}.title` as const)} />
                <FieldError message={form.formState.errors.milestones?.[index]?.title?.message} />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea rows={2} {...form.register(`milestones.${index}.description` as const)} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Amount (wei)</Label>
                  <Input inputMode="numeric" {...form.register(`milestones.${index}.amountWei` as const)} />
                  <FieldError message={form.formState.errors.milestones?.[index]?.amountWei?.message} />
                </div>
                <div className="space-y-2">
                  <Label>Due (local)</Label>
                  <Input type="datetime-local" {...form.register(`milestones.${index}.dueAtLocal` as const)} />
                  <FieldError message={form.formState.errors.milestones?.[index]?.dueAtLocal?.message} />
                </div>
              </div>
            </div>
          ))}
          <FieldError message={form.formState.errors.milestones?.message ?? form.formState.errors.milestones?.root?.message} />
        </div>

        <FieldError message={submitError ?? undefined} />

        <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Publishing…" : "Publish to marketplace"}
        </Button>
      </form>
    </Card>
  );
}
