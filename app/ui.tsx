"use client";
import type { ReactNode } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  Sparkles,
  Leaf,
  Palette,
  BriefcaseBusiness,
  Scale,
  Plus,
  Users,
  Send,
  Heart,
  ChartNoAxesCombined,
} from "lucide-react";
import { metrics, type Lead } from "@/lib/leadgen";
export const icons = [Sparkles, Leaf, Palette, BriefcaseBusiness, Scale, Plus];
export function Choice({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: (string | { value: string; label: string })[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className="choice">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          return (
            <SelectItem key={v} value={v}>
              {typeof o === "string" ? o : o.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Blank({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="blank">
      <EmptyHeader>
        <EmptyTitle className="font-serif text-xl">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
export function Mark({ theme = 0 }: { theme?: number }) {
  const Icon = icons[theme] || Sparkles;
  return (
    <span className={"icon-box tone-" + theme}>
      <Icon size={22} />
    </span>
  );
}
export function Stats({ leads }: { leads: Lead[] }) {
  const m = metrics(leads);
  return (
    <div className="stats">
      {[
        { label: "Leads found", value: m.found, Icon: Users },
        { label: "Contacted", value: m.contacted, Icon: Send },
        { label: "Interested", value: m.interested, Icon: Heart },
        { label: "Converted", value: m.converted, Icon: ChartNoAxesCombined },
      ].map(({ label, value, Icon }, i) => (
        <section className="stat" key={label}>
          <span className={"icon-box tone-" + i}>
            <Icon size={23} />
          </span>
          <small>{label}</small>
          <strong>{value.toLocaleString()}</strong>
          <span className="muted">Excludes sample records</span>
        </section>
      ))}
    </div>
  );
}
/** Server-generated workbook with every lead in the campaign. */
export const campaignExcelUrl = (campaignId: string) =>
  `/api/export?campaign=${encodeURIComponent(campaignId)}`;
export function download(
  name: string,
  body: BlobPart,
  type = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const formatDate = (s: string) =>
  s
    ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString(
        undefined,
        { day: "numeric", month: "short", year: "numeric" },
      )
    : "Not set";
