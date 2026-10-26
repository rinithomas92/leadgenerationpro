// Indian PIN code prefixes (first three digits) by state or union territory,
// from India Post's postal circles. Used to place Overture records that have
// a PIN code but no region. A few border prefixes are shared between states;
// they go to the state that holds most of them.
const ranges: [from: number, to: number, codes: string[]][] = [
  [110, 110, ["DL"]],
  [121, 136, ["HR"]],
  [140, 159, ["PB"]],
  [160, 160, ["CH"]],
  [171, 177, ["HP"]],
  [180, 193, ["JK"]],
  [194, 194, ["LA"]],
  [201, 245, ["UP"]],
  [246, 249, ["UK", "UT"]],
  [250, 261, ["UP"]],
  [262, 263, ["UK", "UT"]],
  [264, 285, ["UP"]],
  [301, 345, ["RJ"]],
  [360, 396, ["GJ"]],
  [400, 402, ["MH"]],
  [403, 403, ["GA"]],
  [404, 445, ["MH"]],
  [450, 488, ["MP"]],
  [490, 497, ["CG", "CT"]],
  [500, 509, ["TG", "TS"]],
  [510, 535, ["AP"]],
  [560, 591, ["KA"]],
  [600, 643, ["TN"]],
  [670, 695, ["KL"]],
  [700, 736, ["WB"]],
  [737, 737, ["SK"]],
  [738, 743, ["WB"]],
  [744, 744, ["AN"]],
  [751, 770, ["OR", "OD"]],
  [781, 788, ["AS"]],
  [790, 792, ["AR"]],
  [793, 794, ["ML"]],
  [795, 795, ["MN"]],
  [796, 796, ["MZ"]],
  [797, 798, ["NL"]],
  [799, 799, ["TR"]],
  [800, 812, ["BR"]],
  [813, 816, ["JH"]],
  [817, 821, ["BR"]],
  [822, 835, ["JH"]],
  [836, 855, ["BR"]],
];
/** Three-digit PIN prefix ranges belonging to a state code (e.g. "MH"). */
export function pinRanges(stateCode: string) {
  const code = stateCode.toUpperCase();
  return ranges.filter(([, , codes]) => codes.includes(code)).map(([from, to]) => [from, to] as [number, number]);
}
export function stateForPin(pin: string) {
  if (!/^[1-9]\d{5}$/.test(pin)) return "";
  const p = Number(pin.slice(0, 3));
  return ranges.find(([from, to]) => p >= from && p <= to)?.[2][0] ?? "";
}

// State and union-territory names with their capitals (and a few very large
// cities), used to keep records with neither a region nor a PIN code out of
// a neighbouring state's bbox.
const places: Record<string, string[]> = {
  AN: ["andaman", "port blair"], AP: ["andhra pradesh", "amaravati", "visakhapatnam", "vijayawada"], AR: ["arunachal", "itanagar"],
  AS: ["assam", "guwahati", "dispur"], BR: ["bihar", "patna"], CH: ["chandigarh"], CG: ["chhattisgarh", "raipur"],
  DL: ["delhi"], GA: ["goa", "panaji", "panjim", "margao"], GJ: ["gujarat", "ahmedabad", "gandhinagar", "surat", "vadodara"],
  HR: ["haryana", "gurugram", "gurgaon", "faridabad"], HP: ["himachal", "shimla"], JK: ["jammu", "kashmir", "srinagar"],
  JH: ["jharkhand", "ranchi"], KA: ["karnataka", "bengaluru", "bangalore", "mysuru", "belagavi"], KL: ["kerala", "thiruvananthapuram", "kochi"],
  LA: ["ladakh", "leh"], MP: ["madhya pradesh", "bhopal", "indore"], MH: ["maharashtra", "mumbai", "pune", "nagpur"],
  MN: ["manipur", "imphal"], ML: ["meghalaya", "shillong"], MZ: ["mizoram", "aizawl"], NL: ["nagaland", "kohima"],
  OR: ["odisha", "orissa", "bhubaneswar"], PB: ["punjab", "ludhiana", "amritsar"], RJ: ["rajasthan", "jaipur"],
  SK: ["sikkim", "gangtok"], TN: ["tamil nadu", "chennai", "coimbatore"], TG: ["telangana", "hyderabad", "secunderabad"],
  TR: ["tripura", "agartala"], UP: ["uttar pradesh", "lucknow", "noida", "ghaziabad"], UK: ["uttarakhand", "dehradun"], WB: ["west bengal", "kolkata"],
};
const aliases: Record<string, string> = { TS: "TG", UT: "UK", OD: "OR", CT: "CG" };
/** Names that place a record in some other state than `stateCode`. */
export function otherStateNames(stateCode: string) {
  const code = aliases[stateCode.toUpperCase()] ?? stateCode.toUpperCase();
  if (!places[code]) return [];
  return Object.entries(places).filter(([c]) => c !== code).flatMap(([, names]) => names);
}
