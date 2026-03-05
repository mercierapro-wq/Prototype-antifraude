import { z } from 'zod';

// ─────────────────────────────────────────────
// Types & Schemas
// ─────────────────────────────────────────────

export type ControlStatus = 'OK' | 'KO' | 'ANOMALIE';

export interface FieldResult {
  present: boolean;
  valid: boolean;
  value: string | null;
  raw_extracted: string | null;
}

/** Sous-contrôle adresses : regroupe émetteur + destinataire en un seul contrôle. */
export interface AddressResult {
  present: boolean;
  valid: boolean;   // true seulement si issuer ET client sont valides
  value: string | null;
  issuer: FieldResult;
  client: FieldResult;
}

export interface LegalMentionsResult {
  score: number;                    // 0–100 (multiples de 12,5)
  sub_controls: {
    siret:                FieldResult;
    tva_number:           FieldResult;
    addresses:            AddressResult;  // émetteur + destinataire
    invoice_number:       FieldResult;
    emission_date:        FieldResult;
    due_date_or_terms:    FieldResult;
    line_items:           FieldResult;
    late_payment_mention: FieldResult;
  };
  /** 'OK' = tous valides · 'ANOMALIE' = siret/TVA/adresse(s) défaillant(s) · 'KO' = autre sous-contrôle défaillant */
  status: ControlStatus;
  /** Messages d'alerte pour chaque sous-contrôle invalide. Vide si status = 'OK'. */
  alerts: string[];
  missing_fields: string[];
  risk_contribution: number;        // score * 0.25
}

// Zod schema for external input validation
export const InvoiceTextSchema = z.object({
  text: z.string().min(1, 'Le texte extrait ne peut pas être vide'),
  source: z.enum(['pdf-parse', 'tesseract', 'raw']).default('raw'),
});

export type InvoiceTextInput = z.infer<typeof InvoiceTextSchema>;

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const FIELD_COUNT = 8;
const POINTS_PER_FIELD = 100 / FIELD_COUNT; // 12.5

// ─────────────────────────────────────────────
// Field extractors
// ─────────────────────────────────────────────

/**
 * SIRET — 14 chiffres, espaces optionnels entre les groupes.
 * Format légal FR : NNN NNN NNN NNNNN
 */
function extractSiret(text: string): FieldResult {
  const SIRET_RE = /\b(\d{3}\s?\d{3}\s?\d{3}\s?\d{5})\b/;
  const match = text.match(SIRET_RE);
  if (!match) {
    return { present: false, valid: false, value: null, raw_extracted: null };
  }
  const raw = match[1];
  const digits = raw.replace(/\s/g, '');
  const valid = /^\d{14}$/.test(digits) && luhnSiret(digits);
  return { present: true, valid, value: digits, raw_extracted: raw };
}

/**
 * Clé de Luhn simplifiée pour SIRET (algorithme INSEE).
 * Vérifie que la somme pondérée est divisible par 10.
 * Pour les SIRET La Poste, règle spéciale avec doublements pairs.
 */
function luhnSiret(siret: string): boolean {
  // Règle spéciale La Poste (SIRET commençant par 356000000)
  if (siret.startsWith('356000000')) {
    let sum = 0;
    for (const ch of siret) sum += parseInt(ch, 10);
    return sum % 5 === 0;
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let n = parseInt(siret[i], 10);
    if (i % 2 === 0) {          // positions paires (0-indexed) : on double
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/**
 * N° TVA intracommunautaire français — FR + 2 chiffres clé + 9 chiffres SIREN.
 * Cohérence : les 9 derniers chiffres du TVA doivent correspondre au SIREN
 * (9 premiers chiffres du SIRET).
 */
function extractTvaNumber(text: string, siretDigits: string | null): FieldResult {
  const TVA_RE = /\b(FR\s*\d{2}\s*\d{9})\b/i;
  const match = text.match(TVA_RE);
  if (!match) {
    return { present: false, valid: false, value: null, raw_extracted: null };
  }
  const raw = match[1];
  const normalized = raw.replace(/\s/g, '').toUpperCase();
  const tvaKey = normalized.slice(2, 4);       // 2 chiffres clé
  const tvaSiren = normalized.slice(4);         // 9 chiffres SIREN

  // Vérification du format strict
  const formatValid = /^FR\d{11}$/.test(normalized);

  // Cohérence TVA ↔ SIRET (si SIRET disponible)
  let coherent = true;
  if (siretDigits && siretDigits.length === 14) {
    const sirenFromSiret = siretDigits.slice(0, 9);
    coherent = tvaSiren === sirenFromSiret;
  }

  // Clé de contrôle TVA FR = (12 + 3 × (SIREN % 97)) % 97
  const sirenNum = parseInt(tvaSiren, 10);
  const expectedKey = ((12 + 3 * (sirenNum % 97)) % 97).toString().padStart(2, '0');
  const keyValid = tvaKey === expectedKey;

  const valid = formatValid && coherent && keyValid;
  return { present: true, valid, value: normalized, raw_extracted: raw };
}

/**
 * Adresse : code postal français 5 chiffres + ville sur la même ligne.
 * Negative lookbehind évite de matcher des chiffres dans les numéros de facture.
 */
function extractAddress(text: string, occurrence: 1 | 2 = 1): FieldResult {
  // Negative lookbehind: CP ne doit pas être précédé d'un chiffre, lettre ou tiret
  // La ville est limitée à la même ligne via [^\S\n] (espaces sans newline)
  const CP_CITY_RE = /(?<![A-Za-z\d\-])(\d{5})[^\S\n]+([A-ZÀ-Ÿa-zà-ÿ'\-]{2,}(?:[^\S\n]+[A-ZÀ-Ÿa-zà-ÿ'\-]{2,})*)/g;
  const matches = [...text.matchAll(CP_CITY_RE)];
  const match = matches[occurrence - 1];
  if (!match) {
    return { present: false, valid: false, value: null, raw_extracted: null };
  }
  const cp = match[1];
  const city = match[2].trim();
  // CP entre 01000 et 98999 (Métropole + DOM)
  const cpNum = parseInt(cp, 10);
  const valid = cpNum >= 1000 && cpNum <= 98999 && city.length >= 2;
  const value = `${cp} ${city}`;
  return { present: true, valid, value, raw_extracted: match[0].trim() };
}

/**
 * Adresses émetteur + destinataire regroupées en un seul sous-contrôle.
 * Le sous-contrôle est valide uniquement si les deux adresses sont valides.
 */
function extractAddresses(text: string): AddressResult {
  const issuer = extractAddress(text, 1);
  const client = extractAddress(text, 2);
  const present = issuer.present || client.present;
  const valid = issuer.valid && client.valid;
  const value = [issuer.value, client.value].filter(Boolean).join(' | ') || null;
  return { present, valid, value, issuer, client };
}

/**
 * Numéro de facture — identifiant alphanumérique non vide.
 * Patterns reconnus : FAC-2024-001, INV/2024/001, F2024-001, N°12345, etc.
 */
function extractInvoiceNumber(text: string): FieldResult {
  const INVOICE_NUM_RE =
    /(?:facture\s*n[°o]?\.?\s*:?\s*|n[°o]?\s*(?:de\s*)?facture\s*:?\s*|invoice\s*#?\s*:?\s*)([\w\-\/]{3,30})/i;
  const STANDALONE_RE = /\b((?:FAC|INV|FACT|F|FC|BILL)[-\/\s]?\d{4}[-\/\s]?\d{2,6})\b/i;

  const match = text.match(INVOICE_NUM_RE) || text.match(STANDALONE_RE);
  if (!match) {
    return { present: false, valid: false, value: null, raw_extracted: null };
  }
  const raw = match[1] || match[0];
  const value = raw.trim();
  const valid = value.length >= 3;
  return { present: true, valid, value, raw_extracted: raw };
}

/**
 * Date d'émission — formats JJ/MM/AAAA, JJ-MM-AAAA, ISO 8601 AAAA-MM-JJ.
 * Validation calendrier : rejette les dates impossibles (32/03/2024, 29/02/2023…).
 */
function extractEmissionDate(text: string): FieldResult {
  const DMY_RE = /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b/;
  const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
  const MONTH_NAMES: Record<string, number> = {
    janvier:1, février:2, fevrier:2, mars:3, avril:4, mai:5, juin:6,
    juillet:7, août:8, aout:8, septembre:9, octobre:10, novembre:11, décembre:12, decembre:12,
  };
  const LONG_RE = /\b(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})\b/i;

  let day: number, month: number, year: number, raw: string;

  const dmyMatch = text.match(DMY_RE);
  const isoMatch = text.match(ISO_RE);
  const longMatch = text.match(LONG_RE);

  if (dmyMatch) {
    raw = dmyMatch[0];
    day = parseInt(dmyMatch[1], 10);
    month = parseInt(dmyMatch[2], 10);
    year = parseInt(dmyMatch[3], 10);
  } else if (isoMatch) {
    raw = isoMatch[0];
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
  } else if (longMatch) {
    raw = longMatch[0];
    day = parseInt(longMatch[1], 10);
    month = MONTH_NAMES[longMatch[2].toLowerCase()] ?? 0;
    year = parseInt(longMatch[3], 10);
  } else {
    return { present: false, valid: false, value: null, raw_extracted: null };
  }

  const valid = isValidCalendarDate(day, month, year);
  const value = valid
    ? `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
    : null;

  return { present: true, valid, value, raw_extracted: raw };
}

function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  if (year < 1900 || year > 2100) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

/**
 * Échéance ou conditions de paiement.
 */
function extractDueDateOrTerms(text: string): FieldResult {
  const TERMS_RE =
    /(?:(?:payable|paiement|règlement|échéance|due)\s*(?:à|le|date|:)?\s*[\w\s\/\-]{3,40})|(?:\bnet\s*\d{1,3}\b)|(?:à réception)/i;
  const DATE_RE = /(?:échéance|due\s*date)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i;

  const dateMatch = text.match(DATE_RE);
  if (dateMatch) {
    return { present: true, valid: true, value: dateMatch[1], raw_extracted: dateMatch[0] };
  }
  const termsMatch = text.match(TERMS_RE);
  if (termsMatch) {
    return { present: true, valid: true, value: termsMatch[0].trim(), raw_extracted: termsMatch[0] };
  }
  return { present: false, valid: false, value: null, raw_extracted: null };
}

/**
 * Lignes de détail (line items) — au moins une description + montant.
 */
function extractLineItems(text: string): FieldResult {
  const LINE_ITEM_RE = /^.{5,60}\s+\d[\d\s]*(?:[.,]\d{2})?\s*€?$/gm;
  const matches = [...text.matchAll(LINE_ITEM_RE)];
  if (matches.length === 0) {
    return { present: false, valid: false, value: null, raw_extracted: null };
  }
  const value = `${matches.length} ligne(s) détectée(s)`;
  return { present: true, valid: true, value, raw_extracted: matches[0][0].trim() };
}

/**
 * Mention pénalités de retard (Art. L441-10 Code de commerce — obligatoire depuis 2013).
 */
function extractLatePaymentMention(text: string): FieldResult {
  const LATE_RE =
    /p[ée]nalit[ée]s?(?:\s+de\s+retard)?|indemnit[ée]\s+forfaitaire|taux\s+l[ée]gal|int[ée]r[êe]ts?\s+de\s+retard|banque\s+centrale\s+europ[ée]enne|BCE\s*\+/i;
  const match = text.match(LATE_RE);
  if (!match) {
    return { present: false, valid: false, value: null, raw_extracted: null };
  }
  return { present: true, valid: true, value: match[0].trim(), raw_extracted: match[0] };
}

// ─────────────────────────────────────────────
// Score & status computation
// ─────────────────────────────────────────────

function computeScore(sub: LegalMentionsResult['sub_controls']): number {
  let validCount = 0;
  if (sub.siret.valid)                validCount++;
  if (sub.tva_number.valid)           validCount++;
  if (sub.addresses.valid)            validCount++;
  if (sub.invoice_number.valid)       validCount++;
  if (sub.emission_date.valid)        validCount++;
  if (sub.due_date_or_terms.valid)    validCount++;
  if (sub.line_items.valid)           validCount++;
  if (sub.late_payment_mention.valid) validCount++;
  return validCount * POINTS_PER_FIELD;
}

function computeStatus(sub: LegalMentionsResult['sub_controls']): ControlStatus {
  // ANOMALIE si l'un des 3 sous-contrôles critiques est défaillant
  if (!sub.siret.valid || !sub.tva_number.valid || !sub.addresses.valid) {
    return 'ANOMALIE';
  }
  const allValid =
    sub.invoice_number.valid &&
    sub.emission_date.valid &&
    sub.due_date_or_terms.valid &&
    sub.line_items.valid &&
    sub.late_payment_mention.valid;
  return allValid ? 'OK' : 'KO';
}

function buildAlerts(sub: LegalMentionsResult['sub_controls']): string[] {
  const alerts: string[] = [];

  if (!sub.siret.valid) {
    alerts.push(sub.siret.present
      ? `SIRET invalide : ${sub.siret.raw_extracted ?? sub.siret.value}`
      : 'SIRET absent');
  }

  if (!sub.tva_number.valid) {
    alerts.push(sub.tva_number.present
      ? `N° TVA invalide : ${sub.tva_number.value ?? sub.tva_number.raw_extracted}`
      : 'N° TVA intracommunautaire absent');
  }

  if (!sub.addresses.valid) {
    const issuerOk = sub.addresses.issuer.valid;
    const clientOk = sub.addresses.client.valid;
    if (!issuerOk && !clientOk) {
      alerts.push('Adresse émetteur et destinataire absentes ou invalides');
    } else if (!issuerOk) {
      alerts.push('Adresse émetteur absente ou invalide');
    } else {
      alerts.push('Adresse destinataire absente ou invalide');
    }
  }

  if (!sub.invoice_number.valid) {
    alerts.push('Numéro de facture absent');
  }

  if (!sub.emission_date.valid) {
    alerts.push(sub.emission_date.present
      ? `Date d'émission invalide : ${sub.emission_date.raw_extracted}`
      : "Date d'émission absente");
  }

  if (!sub.due_date_or_terms.valid) {
    alerts.push("Conditions de paiement ou échéance absentes");
  }

  if (!sub.line_items.valid) {
    alerts.push("Lignes de détail absentes");
  }

  if (!sub.late_payment_mention.valid) {
    alerts.push("Mentions pénalités de retard non trouvées");
  }

  return alerts;
}

function collectMissingFields(sub: LegalMentionsResult['sub_controls']): string[] {
  const missing: string[] = [];
  if (!sub.siret.valid)                missing.push('siret');
  if (!sub.tva_number.valid)           missing.push('tva_number');
  if (!sub.addresses.valid)            missing.push('addresses');
  if (!sub.invoice_number.valid)       missing.push('invoice_number');
  if (!sub.emission_date.valid)        missing.push('emission_date');
  if (!sub.due_date_or_terms.valid)    missing.push('due_date_or_terms');
  if (!sub.line_items.valid)           missing.push('line_items');
  if (!sub.late_payment_mention.valid) missing.push('late_payment_mention');
  return missing;
}

// ─────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────

/**
 * Valide les mentions légales obligatoires d'une facture française.
 * @param input Texte extrait du PDF (via pdf-parse ou tesseract) + source
 * @returns LegalMentionsResult avec score 0-100, statut global et alertes
 */
export function validateLegalMentions(input: InvoiceTextInput): LegalMentionsResult {
  const parsed = InvoiceTextSchema.parse(input);
  const { text } = parsed;

  const siret             = extractSiret(text);
  const tva_number        = extractTvaNumber(text, siret.value);
  const addresses         = extractAddresses(text);
  const invoice_number    = extractInvoiceNumber(text);
  const emission_date     = extractEmissionDate(text);
  const due_date_or_terms = extractDueDateOrTerms(text);
  const line_items        = extractLineItems(text);
  const late_payment_mention = extractLatePaymentMention(text);

  const sub_controls: LegalMentionsResult['sub_controls'] = {
    siret,
    tva_number,
    addresses,
    invoice_number,
    emission_date,
    due_date_or_terms,
    line_items,
    late_payment_mention,
  };

  const score              = computeScore(sub_controls);
  const status             = computeStatus(sub_controls);
  const alerts             = buildAlerts(sub_controls);
  const missing_fields     = collectMissingFields(sub_controls);
  const risk_contribution  = score * 0.25;

  return { score, sub_controls, status, alerts, missing_fields, risk_contribution };
}
