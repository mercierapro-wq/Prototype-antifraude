import { Router, Request, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { validateLegalMentions } from '../controls/legalMentions';
import type {
  AnalyzeResponse,
  CheckItem,
  Finding,
  SubScores,
} from './analyze.types';
import { CONTROL_DEFINITIONS } from './analyze.types';

// ─── Multer — stockage mémoire, limite 10 Mo ──────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'));
    }
  },
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const analyzeRouter = Router();

analyzeRouter.post(
  '/analyze',
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'Aucun fichier PDF fourni (champ "file" manquant)' });
      return;
    }

    try {
      // 1. Extraction texte
      const parsed = await pdfParse(req.file.buffer);
      const { text, numpages } = parsed;

      // 2. Extraction heuristique des champs de surface (invoice_id, company, amount)
      const surface = extractSurfaceFields(text, req.file.originalname);

      // 3. Contrôle mentions légales (module certifié — 8 sous-contrôles)
      const legalMentions = validateLegalMentions({ text, source: 'pdf-parse' });

      // 4. Assemblage de la réponse
      const response = buildResponse(surface, numpages, legalMentions);

      res.json(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inattendue';
      res.status(500).json({ error: `Erreur lors de l'analyse : ${message}` });
    }
  }
);

// ─── Extraction des champs de surface ────────────────────────────────────────

interface SurfaceFields {
  invoice_id: string;
  company: string;
  amount: string;
}

function extractSurfaceFields(text: string, filename: string): SurfaceFields {
  // N° de facture
  const invoiceNumMatch =
    text.match(/(?:facture\s*n[°o]?\.?\s*:?\s*|n[°o]?\s*facture\s*:?\s*)([\w\-\/]+)/i) ??
    text.match(/\b(FAC|INV|FACT|FC|BILL)[-\s]?\d{4}[-\s]?\d{2,6}\b/i);
  const invoice_id = invoiceNumMatch
    ? (invoiceNumMatch[1] ?? invoiceNumMatch[0]).trim().toUpperCase().slice(0, 20)
    : `PDF-${Date.now().toString().slice(-6)}`;

  // Raison sociale (première ligne capitalisée significative)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 3 && l.length < 60);
  const company =
    lines.find(l => /^[A-ZÀÂÉÈÊËÎÏÔÙÛÜ]/.test(l) && !/facture|invoice|date|n°|siret|tva|total/i.test(l))
    ?? filename.replace(/\.pdf$/i, '').slice(0, 40);

  // Montant TTC (plus grand montant en euros)
  const amountMatches = [...text.matchAll(/(\d[\d\s]*(?:[.,]\d{2})?)\s*€|€\s*(\d[\d\s]*(?:[.,]\d{2})?)/g)];
  let maxAmount = 0;
  for (const m of amountMatches) {
    const raw = (m[1] ?? m[2]).replace(/\s/g, '').replace(',', '.');
    const val = parseFloat(raw);
    if (!isNaN(val) && val > maxAmount && val < 1_000_000) maxAmount = val;
  }
  const amount = maxAmount > 0
    ? `€${maxAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'Non détecté';

  return { invoice_id, company: company.slice(0, 40), amount };
}

// ─── Construction de la réponse ───────────────────────────────────────────────

function buildResponse(
  surface: SurfaceFields,
  numPages: number,
  legalMentions: ReturnType<typeof validateLegalMentions>,
): AnalyzeResponse {
  // Score global : risque = 100 − conformité mentions légales
  const risk_score = Math.max(0, 100 - legalMentions.score);
  const risk_level: AnalyzeResponse['risk_level'] =
    risk_score > 65 ? 'high' : risk_score > 35 ? 'medium' : 'low';

  // ── Checks ──────────────────────────────────────────────────────────────────
  const mentionsStatus: CheckItem['status'] =
    legalMentions.status === 'OK'       ? 'pass' :
    legalMentions.status === 'KO'       ? 'warn' : 'fail';  // ANOMALIE → fail

  const siretStatus: CheckItem['status'] =
    legalMentions.sub_controls.siret.present
      ? 'warn'   // présent mais non validé côté INSEE (pas d'appel API)
      : 'fail';

  const checks: CheckItem[] = [
    { ...CONTROL_DEFINITIONS[0], status: mentionsStatus },
    { ...CONTROL_DEFINITIONS[1], status: 'warn' },   // calculs : non implémenté
    { ...CONTROL_DEFINITIONS[2], status: siretStatus },
    { ...CONTROL_DEFINITIONS[3], status: 'warn' },   // visuel : requiert ML backend
    { ...CONTROL_DEFINITIONS[4], status: 'warn' },   // doublons : requiert BDD
    { ...CONTROL_DEFINITIONS[5], status: 'warn' },   // comportemental : requiert historique
  ];

  // ── Sub-scores ───────────────────────────────────────────────────────────────
  const sub_scores: SubScores = {
    struct: risk_score,   // risque structurel ≡ risque global sur mentions
    calc:   0,            // non implémenté
    visual: 0,            // non implémenté
    dup:    0,            // non implémenté
  };

  // ── Findings ─────────────────────────────────────────────────────────────────
  const findings: Finding[] = buildFindings(legalMentions, numPages);

  return {
    invoice_id: surface.invoice_id,
    company:    surface.company,
    amount:     surface.amount,
    num_pages:  numPages,
    risk_score,
    risk_level,
    checks,
    sub_scores,
    findings,
    legal_mentions: legalMentions,
  };
}

// ─── Findings depuis le résultat legalMentions ────────────────────────────────

function buildFindings(
  legalMentions: ReturnType<typeof validateLegalMentions>,
  numPages: number,
): Finding[] {
  const findings: Finding[] = [];
  const sc = legalMentions.sub_controls;

  // SIRET
  if (!sc.siret.present) {
    findings.push({ type: 'critical', icon: '🚨', title: 'SIRET absent', detail: 'Aucun numéro SIRET (14 chiffres) détecté dans le PDF' });
  } else if (!sc.siret.valid) {
    findings.push({ type: 'warning', icon: '⚠️', title: `SIRET détecté : ${sc.siret.value}`, detail: 'Format invalide — clé Luhn incorrecte' });
  } else {
    findings.push({ type: 'warning', icon: '⚠️', title: `SIRET : ${sc.siret.value}`, detail: 'Format valide — vérification INSEE requiert un appel API' });
  }

  // N° TVA
  if (!sc.tva_number.present) {
    findings.push({ type: 'warning', icon: '⚠️', title: 'N° TVA intracommunautaire absent', detail: 'Mention légale obligatoire pour les assujettis à TVA' });
  } else if (!sc.tva_number.valid) {
    findings.push({ type: 'critical', icon: '🚨', title: `TVA invalide : ${sc.tva_number.value}`, detail: 'Clé de contrôle incorrecte ou incohérence avec le SIREN' });
  } else {
    findings.push({ type: 'info', icon: 'ℹ️', title: `N° TVA : ${sc.tva_number.value}`, detail: 'Format et clé de contrôle valides' });
  }

  // Date émission
  if (!sc.emission_date.present) {
    findings.push({ type: 'warning', icon: '⚠️', title: 'Date d\'émission absente', detail: 'Mention obligatoire introuvable dans le document' });
  } else if (!sc.emission_date.valid) {
    findings.push({ type: 'critical', icon: '🚨', title: `Date impossible : ${sc.emission_date.raw_extracted}`, detail: 'Date détectée mais calendrier invalide' });
  }

  // Champs absents restants
  if (legalMentions.missing_fields.length > 0) {
    const labelMap: Record<string, string> = {
      siret: 'SIRET', tva_number: 'N° TVA', addresses: 'Adresses émetteur/client',
      invoice_number: 'N° facture', emission_date: 'Date émission',
      due_date_or_terms: 'Échéance/conditions', line_items: 'Lignes de détail',
      late_payment_mention: 'Pénalités de retard',
    };
    const otherMissing = legalMentions.missing_fields
      .filter(k => !['siret', 'tva_number', 'emission_date'].includes(k))
      .map(k => labelMap[k] ?? k);
    if (otherMissing.length > 0) {
      findings.push({
        type: 'warning', icon: '⚠️',
        title: 'Mentions légales manquantes',
        detail: otherMissing.join(' · '),
      });
    }
  }

  // Contrôles non disponibles sans backend spécialisé
  findings.push({
    type: 'info', icon: 'ℹ️',
    title: 'Contrôles partiels',
    detail: `${numPages} page(s) · Calculs TVA, falsification visuelle et doublons requièrent des modules dédiés`,
  });

  return findings;
}
