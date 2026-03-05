import path from 'path';
import { validateLegalMentions, LegalMentionsResult, InvoiceTextInput } from '../legalMentions';

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadFixture(name: string): InvoiceTextInput {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fixture = require(path.join(__dirname, 'fixtures', name));
  return { text: fixture.text as string, source: fixture.source as InvoiceTextInput['source'] };
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('validateLegalMentions', () => {

  // ── Cas 1 : facture complète ────────────────────────────────────────────
  describe('Facture complète valide', () => {
    let result: LegalMentionsResult;

    beforeAll(() => {
      result = validateLegalMentions(loadFixture('invoice_complete.json'));
    });

    it('retourne un score de 100', () => {
      expect(result.score).toBe(100);
    });

    it('ne contient aucun champ manquant', () => {
      expect(result.missing_fields).toHaveLength(0);
    });

    it('status est OK', () => {
      expect(result.status).toBe('OK');
    });

    it('alerts est vide', () => {
      expect(result.alerts).toHaveLength(0);
    });

    it('risk_contribution est score * 0.25', () => {
      expect(result.risk_contribution).toBeCloseTo(result.score * 0.25, 2);
    });

    it('SIRET est valide', () => {
      expect(result.sub_controls.siret.present).toBe(true);
      expect(result.sub_controls.siret.valid).toBe(true);
      expect(result.sub_controls.siret.value).toBe('73282932000074');
    });

    it('N° TVA est valide et cohérent avec le SIRET', () => {
      expect(result.sub_controls.tva_number.present).toBe(true);
      expect(result.sub_controls.tva_number.valid).toBe(true);
      expect(result.sub_controls.tva_number.value).toBe('FR44732829320');
    });

    it('date d\'émission est valide', () => {
      expect(result.sub_controls.emission_date.present).toBe(true);
      expect(result.sub_controls.emission_date.valid).toBe(true);
    });

    it('adresse émetteur détectée', () => {
      expect(result.sub_controls.addresses.issuer.present).toBe(true);
      expect(result.sub_controls.addresses.issuer.valid).toBe(true);
    });

    it('adresse client détectée', () => {
      expect(result.sub_controls.addresses.client.present).toBe(true);
      expect(result.sub_controls.addresses.client.valid).toBe(true);
    });

    it('sous-contrôle addresses valide (émetteur + destinataire)', () => {
      expect(result.sub_controls.addresses.valid).toBe(true);
    });

    it('numéro de facture détecté', () => {
      expect(result.sub_controls.invoice_number.present).toBe(true);
      expect(result.sub_controls.invoice_number.valid).toBe(true);
    });

    it('lignes de détail détectées', () => {
      expect(result.sub_controls.line_items.present).toBe(true);
      expect(result.sub_controls.line_items.valid).toBe(true);
    });

    it('mention pénalités de retard présente', () => {
      expect(result.sub_controls.late_payment_mention.present).toBe(true);
      expect(result.sub_controls.late_payment_mention.valid).toBe(true);
    });
  });

  // ── Cas 2 : facture sans SIRET ──────────────────────────────────────────
  describe('Facture sans SIRET', () => {
    let result: LegalMentionsResult;

    beforeAll(() => {
      result = validateLegalMentions(loadFixture('invoice_missing_siret.json'));
    });

    it('score est 87.5 (7/8 champs valides)', () => {
      expect(result.score).toBe(87.5);
    });

    it('missing_fields contient "siret"', () => {
      expect(result.missing_fields).toContain('siret');
    });

    it('missing_fields ne contient que "siret"', () => {
      expect(result.missing_fields).toEqual(['siret']);
    });

    it('status est ANOMALIE (SIRET défaillant)', () => {
      expect(result.status).toBe('ANOMALIE');
    });

    it('alerts contient "SIRET absent"', () => {
      expect(result.alerts).toContain('SIRET absent');
    });

    it('alerts contient exactement 1 message', () => {
      expect(result.alerts).toHaveLength(1);
    });

    it('sub_controls.siret.present est false', () => {
      expect(result.sub_controls.siret.present).toBe(false);
      expect(result.sub_controls.siret.valid).toBe(false);
      expect(result.sub_controls.siret.value).toBeNull();
    });

    it('risk_contribution est score * 0.25', () => {
      expect(result.risk_contribution).toBeCloseTo(result.score * 0.25, 2);
    });

    it('les autres sous-contrôles sont valides', () => {
      expect(result.sub_controls.invoice_number.valid).toBe(true);
      expect(result.sub_controls.emission_date.valid).toBe(true);
      expect(result.sub_controls.late_payment_mention.valid).toBe(true);
      expect(result.sub_controls.addresses.issuer.valid).toBe(true);
      expect(result.sub_controls.addresses.client.valid).toBe(true);
      expect(result.sub_controls.addresses.valid).toBe(true);
    });
  });

  // ── Cas 3 : date d'émission impossible ─────────────────────────────────
  describe('Facture avec date impossible (32/03/2024)', () => {
    let result: LegalMentionsResult;

    beforeAll(() => {
      result = validateLegalMentions(loadFixture('invoice_invalid_date.json'));
    });

    it('emission_date.present est true (chaîne trouvée)', () => {
      expect(result.sub_controls.emission_date.present).toBe(true);
    });

    it('emission_date.valid est false (date impossible)', () => {
      expect(result.sub_controls.emission_date.valid).toBe(false);
    });

    it('emission_date.value est null', () => {
      expect(result.sub_controls.emission_date.value).toBeNull();
    });

    it('emission_date.raw_extracted contient la chaîne brute', () => {
      expect(result.sub_controls.emission_date.raw_extracted).toBe('32/03/2024');
    });

    it('missing_fields contient "emission_date"', () => {
      expect(result.missing_fields).toContain('emission_date');
    });

    it('score est 87.5 (7/8 champs valides)', () => {
      expect(result.score).toBe(87.5);
    });

    it('status est KO (date invalide, pas un contrôle critique)', () => {
      expect(result.status).toBe('KO');
    });

    it('alerts contient le message de date invalide', () => {
      expect(result.alerts).toContain("Date d'émission invalide : 32/03/2024");
    });

    it('SIRET et TVA valides malgré la date invalide', () => {
      expect(result.sub_controls.siret.valid).toBe(true);
      expect(result.sub_controls.tva_number.valid).toBe(true);
    });
  });

  // ── Cas 4 : sortie OCR Tesseract (texte bruité) ─────────────────────────
  describe('PDF image — extraction OCR Tesseract', () => {
    let result: LegalMentionsResult;

    beforeAll(() => {
      result = validateLegalMentions(loadFixture('invoice_ocr.json'));
    });

    it('score >= 75 (>= 6 champs sur 8)', () => {
      expect(result.score).toBeGreaterThanOrEqual(75);
    });

    it('SIRET extrait malgré les espaces OCR', () => {
      expect(result.sub_controls.siret.present).toBe(true);
      expect(result.sub_controls.siret.value).toBe('73282932000074');
    });

    it('N° TVA extrait malgré les espaces OCR', () => {
      expect(result.sub_controls.tva_number.present).toBe(true);
      expect(result.sub_controls.tva_number.valid).toBe(true);
    });

    it('adresses émetteur et destinataire extraites', () => {
      expect(result.sub_controls.addresses.issuer.present).toBe(true);
      expect(result.sub_controls.addresses.client.present).toBe(true);
    });

    it('numéro de facture extrait', () => {
      expect(result.sub_controls.invoice_number.present).toBe(true);
    });

    it('date d\'émission extraite et valide', () => {
      expect(result.sub_controls.emission_date.present).toBe(true);
      expect(result.sub_controls.emission_date.valid).toBe(true);
    });

    it('mention pénalités détectée malgré casse OCR ("Penalites")', () => {
      expect(result.sub_controls.late_payment_mention.present).toBe(true);
      expect(result.sub_controls.late_payment_mention.valid).toBe(true);
    });

    it('risk_contribution cohérent', () => {
      expect(result.risk_contribution).toBeCloseTo(result.score * 0.25, 2);
    });
  });

  // ── Tests unitaires des cas limites ─────────────────────────────────────
  describe('Cas limites', () => {

    it('texte vide → erreur Zod', () => {
      expect(() => validateLegalMentions({ text: '', source: 'raw' })).toThrow();
    });

    it('date 29/02/2023 (pas année bissextile) → emission_date.valid false', () => {
      const result = validateLegalMentions({
        text: 'FAC-2023-001\n29/02/2023\n75001 PARIS\n12100 MILLAU',
        source: 'raw',
      });
      expect(result.sub_controls.emission_date.valid).toBe(false);
    });

    it('date 29/02/2024 (année bissextile) → emission_date.valid true', () => {
      const result = validateLegalMentions({
        text: 'FAC-2024-001\n29/02/2024\n75001 PARIS\n12100 MILLAU',
        source: 'raw',
      });
      expect(result.sub_controls.emission_date.valid).toBe(true);
    });

    it('SIRET invalide (15 chiffres) → siret.valid false', () => {
      const result = validateLegalMentions({
        text: 'SIRET : 123 456 789 012345\n',
        source: 'raw',
      });
      // 15 chiffres → ne matche pas la regex 14 chiffres
      expect(result.sub_controls.siret.present).toBe(false);
    });

    it('TVA incohérente avec SIRET → tva_number.valid false', () => {
      const result = validateLegalMentions({
        // SIRET 73282932000074 (SIREN 732829320), TVA FR00111111111 (SIREN 111111111 ≠)
        text: 'SIRET : 732 829 320 00074\nN° TVA : FR00111111111\nFAC-2024-001\n15/03/2024',
        source: 'raw',
      });
      expect(result.sub_controls.tva_number.present).toBe(true);
      expect(result.sub_controls.tva_number.valid).toBe(false);
    });

    it('date ISO 8601 (2024-03-15) → émission_date.valid true', () => {
      const result = validateLegalMentions({
        text: '2024-03-15\nFAC-2024-001',
        source: 'raw',
      });
      expect(result.sub_controls.emission_date.present).toBe(true);
      expect(result.sub_controls.emission_date.valid).toBe(true);
    });

    it('mention "indemnité forfaitaire" → late_payment_mention valide', () => {
      const result = validateLegalMentions({
        text: 'FAC-2024-001\nIndemnité forfaitaire de recouvrement : 40 €',
        source: 'raw',
      });
      expect(result.sub_controls.late_payment_mention.valid).toBe(true);
    });

    it('status OK si tous les 8 sous-contrôles sont valides', () => {
      // Même fixture que la facture complète
      const result = validateLegalMentions(loadFixture('invoice_complete.json'));
      expect(result.status).toBe('OK');
      expect(result.alerts).toHaveLength(0);
    });

    it('status ANOMALIE si TVA invalide', () => {
      const result = validateLegalMentions({
        text: 'SIRET : 732 829 320 00074\nN° TVA : FR00111111111\nFAC-2024-001\n15/03/2024',
        source: 'raw',
      });
      expect(result.status).toBe('ANOMALIE');
    });
  });
});
