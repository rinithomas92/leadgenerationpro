"use client";
import { useState } from "react";
import { AtSign, ExternalLink, Globe, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  deduplicate,
  localDate,
  normalizeHandle,
  now,
  platforms,
  professions,
  type Campaign,
  type Lead,
  type Workspace,
} from "@/lib/leadgen";
import {
  allowedPartnerships,
  displayHandle,
  isGloss,
  newCreatorLead,
  parseFollowers,
  primaryProfile,
  profileLinks,
  profileUrl,
  searchLinks,
  type Partnership,
  type Platform,
} from "@/lib/gloss";
import { Choice, Field } from "./ui";

export type CreatorForm = {
  name: string;
  profession: string;
  location: string;
  platform: Platform;
  instagram: string;
  instagramUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  linkedinUrl: string;
  facebookUrl: string;
  website: string;
  email: string;
  phone: string;
  followers: string;
  engagement: string;
  partnership: Partnership;
  source: string;
  photoUrl: string;
  tags: string;
  notes: string;
};
export function blankCreatorForm(c?: Campaign): CreatorForm {
  return {
    name: "",
    profession: c?.gloss?.professions[0] || "Makeup Artist",
    location: c?.location || "",
    platform: "Instagram",
    instagram: "",
    instagramUrl: "",
    tiktokUrl: "",
    youtubeUrl: "",
    linkedinUrl: "",
    facebookUrl: "",
    website: "",
    email: "",
    phone: "",
    followers: "",
    engagement: "",
    partnership: c ? allowedPartnerships(c)[0] || "Creator Partner" : "Creator Partner",
    source: "",
    photoUrl: "",
    tags: "",
    notes: "",
  };
}
export function creatorFormFromLead(l: Lead): CreatorForm {
  const c = l.creator;
  return {
    ...blankCreatorForm(),
    name: l.name,
    location: l.location,
    website: l.website,
    email: l.email,
    phone: l.phone,
    source: l.source,
    tags: l.tags,
    notes: l.notes,
    ...(c && {
      profession: c.profession,
      platform: c.platform,
      instagram: displayHandle(c.instagram),
      instagramUrl: c.instagramUrl,
      tiktokUrl: c.tiktokUrl,
      youtubeUrl: c.youtubeUrl,
      linkedinUrl: c.linkedinUrl,
      facebookUrl: c.facebookUrl,
      followers: c.followers === null ? "" : String(c.followers),
      engagement: c.engagement,
      partnership: c.partnership,
      photoUrl: c.photoUrl,
    }),
  };
}
/** Validates a form into a creator lead. Existing leads keep their id, stage and history. */
export function creatorFromForm(f: CreatorForm, campaign: Campaign, existing?: Lead): Lead {
  const followers = parseFollowers(f.followers);
  if (followers === undefined)
    throw new Error("Followers must be a number such as 12500 or 12.5K.");
  const fresh = newCreatorLead(
    campaign,
    {
      name: f.name,
      location: f.location,
      website: f.website,
      email: f.email,
      phone: f.phone,
      source: f.source,
      notes: f.notes,
      tags: f.tags,
      creator: {
        profession: f.profession,
        platform: f.platform,
        // A pasted handle is enough; the canonical URL is derived from it.
        instagram: f.instagram,
        instagramUrl: f.instagram.trim() ? "" : f.instagramUrl,
        tiktokUrl: f.tiktokUrl,
        youtubeUrl: f.youtubeUrl,
        linkedinUrl: f.linkedinUrl,
        facebookUrl: f.facebookUrl,
        followers,
        engagement: f.engagement,
        partnership: f.partnership,
        photoUrl: f.photoUrl,
        verifiedAt: existing?.creator?.verifiedAt || "",
      },
    },
    existing ? "Edited" : "Added manually",
  );
  if (!existing) return fresh;
  return {
    ...existing,
    ...fresh,
    id: existing.id,
    stage: existing.stage,
    discoveredAt: existing.discoveredAt,
    followUp: existing.followUp,
    contactedAt: existing.contactedAt,
    sourceLabel:
      existing.source === fresh.source ? existing.sourceLabel : fresh.sourceLabel,
    history: existing.history,
  };
}

export function CreatorAvatar({ lead }: { lead: Lead }) {
  const [failed, setFailed] = useState(false);
  const photo = profileUrl("Website", lead.creator?.photoUrl || "");
  return photo && !failed ? (
    // Photos are user-supplied public https URLs; nothing is fetched server-side.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="creator-avatar"
      src={photo}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="creator-avatar" aria-hidden="true">
      {lead.name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
/** The prominent profile action: Instagram first, otherwise the primary profile. */
export function ProfileButton({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  const links = profileLinks(lead);
  const target = links.find((l) => l.platform === "Instagram") || primaryProfile(lead);
  if (!target) return <span className="muted">No public profile</span>;
  const label = target.platform === "Instagram" ? "Open Instagram" : "Open profile";
  return (
    <a
      className={compact ? "profile-chip" : "primary profile-button"}
      href={target.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} for ${lead.name} (opens in a new tab)`}
    >
      {target.platform === "Instagram" ? <AtSign size={15} /> : <Globe size={15} />}
      {label}
    </a>
  );
}
export function ProfileLinks({ lead }: { lead: Lead }) {
  const links = profileLinks(lead);
  if (links.length < 2) return null;
  return (
    <div className="button-row profile-links">
      {links.slice(1).map((l) => (
        <a key={l.platform} className="secondary" href={l.url} target="_blank" rel="noopener noreferrer">
          {l.platform === "Website" ? "Website / portfolio" : l.platform} <ExternalLink size={14} />
        </a>
      ))}
    </div>
  );
}

export function CreatorFields({
  value,
  onChange,
  campaign,
  compact = false,
}: {
  value: CreatorForm;
  onChange: (f: CreatorForm) => void;
  campaign?: Campaign;
  /** Hides tags and notes when the surrounding view already edits them. */
  compact?: boolean;
}) {
  const set = (k: keyof CreatorForm) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  const input = (k: keyof CreatorForm, label: string, placeholder = "", hint?: string) => (
    <Field label={label} hint={hint}>
      <input className="input" maxLength={300} value={value[k]} onChange={set(k)} placeholder={placeholder} />
    </Field>
  );
  const partnerships = campaign ? allowedPartnerships(campaign) : [];
  return (
    <div className="form-grid">
      {input("name", "Name", "e.g. Priya Kulkarni")}
      <Field label="Profession">
        <input
          className="input"
          list="gloss-professions"
          maxLength={300}
          value={value.profession}
          onChange={set("profession")}
        />
        <datalist id="gloss-professions">
          {professions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>
      {input("location", "Location", "e.g. Pune · Baner")}
      <Field label="Primary contact platform">
        <Choice
          label="Primary contact platform"
          value={value.platform}
          onChange={(v) => onChange({ ...value, platform: v as Platform })}
          options={[...platforms]}
        />
      </Field>
      <div className="span-2 instagram-field">
        {input(
          "instagram",
          "Instagram handle or profile URL",
          "@handle or https://www.instagram.com/handle/",
          normalizeHandle(value.instagram)
            ? `Profile: https://www.instagram.com/${normalizeHandle(value.instagram)}/`
            : "Instagram is the primary outreach channel. Public profiles only.",
        )}
      </div>
      {input("tiktokUrl", "TikTok URL", "https://www.tiktok.com/@…")}
      {input("youtubeUrl", "YouTube URL", "https://www.youtube.com/@…")}
      {input("linkedinUrl", "LinkedIn URL", "https://www.linkedin.com/in/…")}
      {input("facebookUrl", "Facebook URL", "https://www.facebook.com/…")}
      {input("website", "Website / portfolio", "https://…")}
      {input("followers", "Followers (as shown publicly)", "e.g. 12.5K")}
      {input("engagement", "Engagement (optional)", "e.g. 3.2% average")}
      {partnerships.length > 0 && (
        <Field label="Partnership type">
          <Choice
            label="Partnership type"
            value={partnerships.includes(value.partnership) ? value.partnership : partnerships[0]}
            onChange={(v) => onChange({ ...value, partnership: v as Partnership })}
            options={partnerships}
          />
        </Field>
      )}
      {input("email", "Public email (optional)")}
      {input("phone", "Public phone (optional)")}
      {input(
        "source",
        "Source URL",
        "Where you found this profile",
        "Defaults to the primary profile link.",
      )}
      {input(
        "photoUrl",
        "Profile photo URL (optional)",
        "https://…",
        "Only use an image you are permitted to display.",
      )}
      {!compact && input("tags", "Tags", "e.g. bridal, priority")}
      {!compact && (
        <div className="span-2">
          <Field label="Notes">
            <textarea className="input" rows={3} maxLength={8000} value={value.notes} onChange={set("notes")} />
          </Field>
        </div>
      )}
    </div>
  );
}

export function AddCreatorDialog({
  open,
  onOpenChange,
  state,
  save,
  busy,
  initialCampaign,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  state: Workspace;
  save: (s: Workspace, message?: string) => Promise<boolean>;
  busy: boolean;
  initialCampaign: string;
  onAdded: (campaignId: string) => void;
}) {
  const campaigns = state.campaigns.filter((c) => isGloss(c) && !c.demo && c.status !== "Archived");
  const [target, setTarget] = useState(
    campaigns.find((c) => c.id === initialCampaign)?.id || campaigns[0]?.id || "none",
  );
  const campaign = campaigns.find((c) => c.id === target);
  const [form, setForm] = useState(() => blankCreatorForm(campaign));
  async function add() {
    try {
      if (!campaign) throw new Error("Create a Gloss creator or professional campaign first.");
      const lead = creatorFromForm(form, campaign);
      if (!deduplicate(state.leads, [lead]).length)
        throw new Error("This profile is already saved in the campaign.");
      if (await save({ ...state, leads: [...state.leads, lead] }, `${lead.name} added`)) {
        setForm(blankCreatorForm(campaign));
        onAdded(campaign.id);
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add creator.");
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a creator</DialogTitle>
          <DialogDescription>
            Add someone you found on a public profile. Record only what is publicly visible;
            nothing is fetched from the platform.
          </DialogDescription>
        </DialogHeader>
        <Field label="Gloss campaign">
          <Choice
            label="Creator campaign"
            value={target}
            onChange={(v) => {
              setTarget(v);
              const c = campaigns.find((x) => x.id === v);
              if (c) setForm({ ...form, partnership: allowedPartnerships(c)[0] });
            }}
            options={
              campaigns.length
                ? campaigns.map((c) => ({ value: c.id, label: `${c.name} · ${c.audience}` }))
                : [{ value: "none", label: "Create a Gloss campaign first" }]
            }
          />
        </Field>
        <CreatorFields value={form} onChange={setForm} campaign={campaign} />
        <button className="primary" disabled={busy || !campaign} onClick={add}>
          {busy ? "Saving…" : "Add creator"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

export function OpenSearch({ campaign }: { campaign: Campaign }) {
  const options = campaign.gloss?.professions.length ? campaign.gloss.professions : [...professions];
  const [profession, setProfession] = useState<string>(options[0]);
  return (
    <details className="panel open-search" open>
      <summary>
        <Search size={16} /> Open Search · find {campaign.audience === "Creator Partners" ? "creators" : "professionals"} yourself
      </summary>
      <p className="muted">
        These links open public search pages in a new tab using only your campaign keywords.
        Review each profile yourself, then use Add creator with its public profile URL.
      </p>
      <div className="toolbar">
        <Choice label="Search profession" value={profession} onChange={setProfession} options={[...options]} />
      </div>
      <div className="button-row">
        {searchLinks(campaign, profession).map((l, i) => (
          <a
            key={l.url}
            className={i === 0 ? "primary" : "secondary"}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {l.label} <ExternalLink size={14} />
          </a>
        ))}
      </div>
    </details>
  );
}

export function verifyCreator(lead: Lead): Lead {
  if (!lead.creator) return lead;
  return {
    ...lead,
    creator: { ...lead.creator, verifiedAt: localDate() },
    history: [
      ...lead.history,
      { at: now(), event: "Public profile manually verified" },
    ].slice(-500),
  };
}
