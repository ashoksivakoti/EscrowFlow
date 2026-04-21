"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import type { CreateProjectRequest } from "@escrowflow/types";

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

const createProjectSchema = z.object({
  title: z.string().trim().min(3, "Use at least 3 characters").max(120),
  description: z.string().trim().max(10000).optional(),
  freelancerWalletAddress: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Enter a valid EVM wallet address"),
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

type CreateProjectFormValues = z.infer<typeof createProjectSchema>;

const emptyMilestone: CreateProjectFormValues["milestones"][number] = {
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

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function formatBigIntAmount(value: bigint): string {
  return value.toLocaleString("en-US");
}

export function CreateProjectForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successProjectId, setSuccessProjectId] = useState<string | null>(null);
  const [agreementFile, setAgreementFile] = useState<File | null>(null);

  const form = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      title: "",
      description: "",
      freelancerWalletAddress: "",
      chainId: DEFAULT_CHAIN_ID,
      escrowContractAddress: DEFAULT_ESCROW_ADDRESS,
      onChainProjectId: "",
      paymentTokenAddress: DEFAULT_TOKEN_ADDRESS,
      milestones: [emptyMilestone],
    },
  });

  const milestones = useWatch({
    control: form.control,
    name: "milestones",
  });

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

  const milestoneArray = useFieldArray({
    control: form.control,
    name: "milestones",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    setSuccessProjectId(null);
    try {
      const milestonesPayload = values.milestones.map((m: CreateProjectFormValues["milestones"][number]) => ({
        title: m.title.trim(),
        description: m.description?.trim() ? m.description.trim() : null,
        amountWei: m.amountWei,
        dueAt: parseLocalDateTimeToIso(m.dueAtLocal),
      }));

      const payload: CreateProjectRequest = {
        title: values.title.trim(),
        description: values.description?.trim() ? values.description.trim() : null,
        freelancerWalletAddress: values.freelancerWalletAddress.trim(),
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
        payload.agreement = {
          mode: "file",
          fileName: agreementFile.name,
          mimeType: agreementFile.type || "application/octet-stream",
          fileBase64: await fileToBase64(agreementFile),
        };
      }

      const res = await fetch("/api/v1/projects", {
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
      setSuccessProjectId(projectId);
      form.reset({
        title: "",
        description: "",
        freelancerWalletAddress: "",
        chainId: DEFAULT_CHAIN_ID,
        escrowContractAddress: DEFAULT_ESCROW_ADDRESS,
        onChainProjectId: "",
        paymentTokenAddress: DEFAULT_TOKEN_ADDRESS,
        milestones: [emptyMilestone],
      });
      setAgreementFile(null);

      setTimeout(() => {
        router.replace(`/projects/${projectId}/funding`);
      }, 1000);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setSubmitError(error.message);
        return;
      }
      setSubmitError("Could not create project. Please try again.");
    }
  });

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader>
        <CardTitle>Create escrow project</CardTitle>
        <CardDescription>
          Define milestones, assign a freelancer wallet, and optionally attach
          an agreement artifact to IPFS.
        </CardDescription>
      </CardHeader>

      {successProjectId ? (
        <div
          className="mx-4 mb-4 space-y-3 rounded-xl border border-emerald-300/35 bg-emerald-300/10 px-4 py-5 text-sm sm:mx-6 sm:mb-6"
          role="status"
        >
          <p className="font-medium text-emerald-100">
            Project created successfully.
          </p>
          <p className="text-emerald-100/90">
            Project ID: <span className="break-all font-mono">{successProjectId}</span>
          </p>
          <p className="text-emerald-100/90">
            Redirecting to dashboard…
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="flex w-full max-w-full flex-col gap-6 overflow-x-hidden px-4 pb-6 sm:px-6"
        >
          <section className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 sm:p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Project basics</p>
            <p className="mt-1 text-xs text-zinc-400">
              Define scope and assign the freelancer wallet for this escrow contract.
            </p>
          </section>

          <div className="space-y-2">
            <Label htmlFor="title">Project title</Label>
            <Input
              id="title"
              placeholder="e.g. EscrowFlow landing page redesign"
              aria-invalid={Boolean(form.formState.errors.title)}
              {...form.register("title")}
            />
            <FieldError message={form.formState.errors.title?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Project description</Label>
            <Textarea
              id="description"
              placeholder="Scope, deliverables, and high-level expectations."
              aria-invalid={Boolean(form.formState.errors.description)}
              {...form.register("description")}
            />
            <FieldError message={form.formState.errors.description?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="freelancerWalletAddress">Freelancer wallet</Label>
            <Input
              id="freelancerWalletAddress"
              placeholder="0x..."
              autoComplete="off"
              aria-invalid={Boolean(form.formState.errors.freelancerWalletAddress)}
              {...form.register("freelancerWalletAddress")}
            />
            <FieldError
              message={form.formState.errors.freelancerWalletAddress?.message}
            />
          </div>

          <section className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-950/45 p-3 sm:p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">On-chain context</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="chainId">Chain id (optional)</Label>
                <Input
                  id="chainId"
                  inputMode="numeric"
                  placeholder="31337"
                  aria-invalid={Boolean(form.formState.errors.chainId)}
                  {...form.register("chainId")}
                />
                <FieldError message={form.formState.errors.chainId?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="onChainProjectId">On-chain project id (optional)</Label>
                <Input
                  id="onChainProjectId"
                  inputMode="numeric"
                  placeholder="1"
                  aria-invalid={Boolean(form.formState.errors.onChainProjectId)}
                  {...form.register("onChainProjectId")}
                />
                <FieldError message={form.formState.errors.onChainProjectId?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="escrowContractAddress">
                  Escrow contract address (optional)
                </Label>
                <Input
                  id="escrowContractAddress"
                  placeholder="0x..."
                  aria-invalid={Boolean(form.formState.errors.escrowContractAddress)}
                  {...form.register("escrowContractAddress")}
                />
                <FieldError
                  message={form.formState.errors.escrowContractAddress?.message}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="paymentTokenAddress">Token address (optional)</Label>
                <Input
                  id="paymentTokenAddress"
                  placeholder="0x..."
                  aria-invalid={Boolean(form.formState.errors.paymentTokenAddress)}
                  {...form.register("paymentTokenAddress")}
                />
                <FieldError message={form.formState.errors.paymentTokenAddress?.message} />
              </div>
            </div>
          </section>

          <div className="space-y-2">
            <Label htmlFor="agreementFile">Agreement file (optional)</Label>
            <Input
              id="agreementFile"
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setAgreementFile(file);
              }}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Uploaded to IPFS with the project record (size and MIME limits apply).
            </p>
          </div>

          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-300">
                Milestones
              </h2>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => milestoneArray.append(emptyMilestone)}
              >
                Add milestone
              </Button>
            </div>

            {milestoneArray.fields.map((field, index) => (
              <div
                key={field.id}
                className="space-y-4 rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-700/90"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Milestone {index + 1}
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (milestoneArray.fields.length === 1) {
                        form.setError("milestones", {
                          type: "manual",
                          message: "At least one milestone is required",
                        });
                        return;
                      }
                      milestoneArray.remove(index);
                    }}
                  >
                    Remove
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`milestones.${index}.title`}>Title</Label>
                  <Input
                    id={`milestones.${index}.title`}
                    placeholder="e.g. Wireframes and style guide"
                    aria-invalid={Boolean(form.formState.errors.milestones?.[index]?.title)}
                    {...form.register(`milestones.${index}.title`)}
                  />
                  <FieldError
                    message={form.formState.errors.milestones?.[index]?.title?.message}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`milestones.${index}.description`}>
                    Description
                  </Label>
                  <Textarea
                    id={`milestones.${index}.description`}
                    placeholder="What should be delivered for this milestone?"
                    aria-invalid={Boolean(
                      form.formState.errors.milestones?.[index]?.description,
                    )}
                    {...form.register(`milestones.${index}.description`)}
                  />
                  <FieldError
                    message={
                      form.formState.errors.milestones?.[index]?.description?.message
                    }
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`milestones.${index}.amountWei`}>
                      Amount (smallest token units)
                    </Label>
                    <Input
                      id={`milestones.${index}.amountWei`}
                      inputMode="numeric"
                      placeholder="1000000"
                      aria-invalid={Boolean(
                        form.formState.errors.milestones?.[index]?.amountWei,
                      )}
                      {...form.register(`milestones.${index}.amountWei`)}
                    />
                    <FieldError
                      message={
                        form.formState.errors.milestones?.[index]?.amountWei?.message
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`milestones.${index}.dueAtLocal`}>
                      Deadline
                    </Label>
                    <Input
                      id={`milestones.${index}.dueAtLocal`}
                      type="datetime-local"
                      aria-invalid={Boolean(
                        form.formState.errors.milestones?.[index]?.dueAtLocal,
                      )}
                      {...form.register(`milestones.${index}.dueAtLocal`)}
                    />
                    <FieldError
                      message={
                        form.formState.errors.milestones?.[index]?.dueAtLocal?.message
                      }
                    />
                  </div>
                </div>
              </div>
            ))}

            <FieldError message={form.formState.errors.milestones?.message} />
          </section>

          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/65 px-4 py-3 text-sm">
            <p className="font-medium text-zinc-200">
              Total milestone amount
            </p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-zinc-100">
              {formatBigIntAmount(totalMilestoneAmount)}
            </p>
          </div>

          <FieldError message={submitError ?? undefined} className="text-center" />

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => router.push("/dashboard")}
            >
              Cancel
            </Button>
            <Button type="submit" className="w-full sm:w-auto" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Creating…" : "Create project"}
            </Button>
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Need a freelancer wallet first? Ask them to sign in once.{" "}
            <Link href="/login" className="text-cyan-300 hover:text-cyan-200 hover:underline">
              Go to login
            </Link>
            .
          </p>
        </form>
      )}
    </Card>
  );
}
