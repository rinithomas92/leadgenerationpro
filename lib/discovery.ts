import {
  assessFit,
  now,
  uid,
  safeUrl,
  wellnessTerms,
  type Campaign,
  type Lead,
} from "./leadgen.ts";

// Public business facts checked against the linked business websites on 2026-09-14.
// These are research snapshots, not claims of buying intent or verified deliverability.
export const researchedBusinesses = [
  {
    name: "Symbiosis Centre for Emotional Wellbeing",
    industry: "Mental wellness and counselling",
    location: "Pune · Senapati Bapat Road",
    website: "https://www.scew.edu.in/",
    email: "scew.event@siu.edu.in",
    phone: "020 25925173",
    source: "https://www.scew.edu.in/faq.php",
  },
  {
    name: "Maharashtra Institute of Mental Health",
    industry: "Mental wellness and counselling",
    location: "Pune · Pashan",
    website: "https://www.mimhpune.org/",
    email: "dp.mimhpune@gov.in",
    phone: "020 29518222",
    source: "https://www.mimhpune.org/contact",
  },
  {
    name: "The Counseling Center",
    industry: "Mental wellness and counselling",
    location: "Pune · Aundh",
    website: "https://thecounselingcenter.in/",
    email: "thecounsellingcenter@gmail.com",
    phone: "+91 9823216629",
    source: "https://thecounselingcenter.in/",
  },
  {
    name: "Wellesley Hotel",
    industry: "Boutique hotels",
    location: "Pune · Connaught Road",
    website: "https://wellesleyhotel.in/",
    email: "post@wellesleyhotel.in",
    phone: "+91 9623411001",
    source: "https://wellesleyhotel.in/",
  },
  {
    name: "Hotel Ashray",
    industry: "Boutique hotels",
    location: "Pune · Parvati Road",
    website: "https://www.thehotelashray.com/",
    email: "hotelashray@gmail.com",
    phone: "+91 7767081818",
    source: "https://www.thehotelashray.com/",
  },
  {
    name: "Verb Interior",
    industry: "Interior designers",
    location: "Pune · Baner",
    website: "https://www.verbinterior.com/",
    email: "designsales@verbinterior.com",
    phone: "+91 81818 35353",
    source: "https://www.verbinterior.com/contact",
  },
  {
    name: "Design Inside",
    industry: "Interior designers",
    location: "Pune · Kharadi",
    website: "https://designinside.co.in/",
    email: "contact@designinside.co.in",
    phone: "+91 7028733810",
    source: "https://designinside.co.in/pune-branch/",
  },
  {
    name: "The Pune Interior Company",
    industry: "Interior designers",
    location: "Pune · Gahunje, Pimpri Chinchwad",
    website: "https://puneinterior.in/",
    email: "thepuneinterior@gmail.com",
    phone: "+91 95033 93883",
    source: "https://puneinterior.in/contact",
  },
  {
    name: "AKS Designs",
    industry: "Interior designers",
    location: "Pune · Chinchwad",
    website: "https://www.aksdesignss.com/",
    email: "info@aksdesignss.com",
    phone: "+91 8830613277",
    source: "https://www.aksdesignss.com/contact-us/",
  },
];
export function researchLeads(c: Campaign): Lead[] {
  if (!/\bpune\b/i.test(c.location)) return [];
  return researchedBusinesses
    .filter((b) =>
      c.markets.some((m) =>
        b.industry === "Mental wellness and counselling"
          ? wellnessTerms.test(m.name)
          : b.industry === "Interior designers"
            ? /interior|architect/i.test(m.name)
            : /hotel|hospitality/i.test(m.name),
      ),
    )
    .map((b) => makeLead(c, b, "Business website · researched 14 Sep 2026"));
}
type Business = {
  name: string;
  industry: string;
  location: string;
  website: string;
  email: string;
  phone: string;
  source: string;
};
export function makeLead(c: Campaign, b: Business, sourceLabel: string): Lead {
  const lead: Lead = {
    ...b,
    id: uid(),
    campaignId: c.id,
    sourceLabel,
    discoveredAt: now(),
    score: 0,
    reason: "",
    missing: "",
    stage: "New",
    notes: "",
    tags: "",
    followUp: "",
    contactedAt: "",
    demo: false,
    history: [
      { at: now(), event: "Real business record added from " + sourceLabel },
    ],
    kind: "business",
    checkedAt: "",
    sourceVerifiedAt: "",
    scope: "" as const,
  };
  return { ...lead, ...assessFit(lead, c) };
}
export const categories = [
  {
    match: /caf[eé]|restaurant|coffee|\bchefs?\b/i,
    key: "amenity",
    values: ["cafe", "restaurant"],
    industry: "Cafés and restaurants",
  },
  {
    match: /hotel|hospitality/i,
    key: "tourism",
    values: ["hotel", "guest_house"],
    industry: "Hotels",
  },
  {
    match: /interior|architect/i,
    key: "office",
    values: ["interior_design", "architect"],
    industry: "Interior designers",
  },
  {
    match: /salon|beauty|bridal|hair|make-?up|nail/i,
    key: "shop",
    values: ["beauty", "hairdresser"],
    industry: "Salons and beauty",
  },
  {
    match: /account|bookkeep|tax|cfo/i,
    key: "office",
    values: ["accountant", "tax_advisor"],
    industry: "Accounting firms",
  },
  {
    match: /legal|law|advocat/i,
    key: "office",
    values: ["lawyer"],
    industry: "Law firms",
  },
  {
    match: /college|universit|coaching/i,
    key: "amenity",
    values: ["college", "university"],
    industry: "Colleges and universities",
  },
  {
    match: wellnessTerms,
    key: "healthcare",
    values: ["psychotherapist", "psychologist", "psychiatrist", "counselling"],
    industry: "Mental wellness and counselling",
  },
  {
    match: wellnessTerms,
    key: "office",
    values: ["psychologist", "therapist", "counselling"],
    industry: "Mental wellness and counselling",
  },
  {
    match: /galler/i,
    key: "tourism",
    values: ["gallery"],
    industry: "Art galleries",
  },
  {
    match: /photograph/i,
    key: "shop",
    values: ["photo"],
    industry: "Photography businesses",
  },
];
export function buildDirectoryQuery(c: Campaign) {
  const city = c.location.split(",")[0].trim();
  if (!/^[\p{L}\p{N} .'-]{2,80}$/u.test(city))
    throw new Error(
      "Use a city name such as Pune or Mumbai as the target location.",
    );
  const selected = categories.filter((k) =>
    c.markets.some((m) => k.match.test(m.name)),
  );
  if (!selected.length)
    throw new Error(
      "These markets are not covered by the public map directory yet. Import leads with source links instead.",
    );
  const name = JSON.stringify(city);
  const clauses = selected
    .map(
      (k) =>
        `nwr["${k.key}"~"^(${k.values.join("|")})$"]["name"](area.search);`,
    )
    .join("");
  return {
    query: `[out:json][timeout:20];area["name"=${name}]["boundary"="administrative"]->.search;(${clauses});out tags center 40;`,
    selected,
    city,
  };
}
export type DirectoryElement = {
  type: "node" | "way" | "relation";
  id: number;
  tags: Record<string, string>;
};
export function directoryLeads(
  c: Campaign,
  elements: DirectoryElement[],
): Lead[] {
  const { selected, city } = buildDirectoryQuery(c);
  return elements
    .filter(
      (e) =>
        e.tags?.name &&
        ["node", "way", "relation"].includes(e.type) &&
        Number.isSafeInteger(e.id),
    )
    .slice(0, 40)
    .map((e) => {
      const t = e.tags;
      const category = selected.find((k) => k.values.includes(t[k.key]));
      return makeLead(
        c,
        {
          name: t.name.slice(0, 300),
          industry: category?.industry || "Business",
          location: [
            t["addr:city"] || city,
            t["addr:suburb"] || t["addr:street"],
          ]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 300),
          website: safeUrl(t["contact:website"] || t.website || ""),
          email: (t["contact:email"] || t.email || "").slice(0, 300),
          phone: (t["contact:phone"] || t.phone || "").slice(0, 300),
          source: `https://www.openstreetmap.org/${e.type}/${e.id}`,
        },
        "OpenStreetMap contributors · public directory",
      );
    });
}
