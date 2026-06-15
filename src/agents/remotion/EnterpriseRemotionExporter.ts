/**
 * EnterpriseRemotionExporter
 *
 * Produces demo-package.json for the enterprise video template.
 * The enterprise package extends the base RemotionPackage with:
 *   • brollScenes    — 3 problem-statement scenes (before product demo)
 *   • scenes         — regular product demo screens (static camera, presenter overlay)
 *   • benefitSlide   — animated value-add bullet slide (after product demo)
 *   • presenterClose — full-screen presenter closing scene
 *   • presenterConfig — global presenter overlay settings
 *   • meta.templateId = 'enterprise'
 *
 * Opening title card is kept in the package (backward compat) but
 * EnterpriseVideo.tsx ignores it — the video starts with brollScenes instead.
 */

import * as fs   from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

import type { StoryArc }          from '../../core/domain/entities/SalesStory';
import type { BusinessValueOutput } from '../../core/domain/entities/BusinessValueOutput';
import type {
  RemotionPackage,
  EnterpriseBRollSceneData,
  EnterpriseBenefitSlideData,
  EnterpriseBenefitBullet,
  BenefitIconKey,
  EnterprisePresenterCloseData,
  EnterprisePresenterConfig,
} from '../../core/domain/entities/RemotionPackage';
import { RemotionExporter } from './RemotionExporter';
import type { RemotionExportInput, RemotionExportResult } from './RemotionExporter';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const BROLL_SCENE_SEC      =  6;   // each B-roll problem scene duration
const BROLL_SCENE_COUNT    =  3;
const PRODUCT_SCENE_MAX_SEC = 12;  // cap per product scene so total stays renderable
const BENEFIT_SLIDE_SEC    = 18;   // benefit slide duration
const PRESENTER_CLOSE_SEC  = 16;   // closing presenter scene duration

const ENTERPRISE_PRESENTER_SRC = 'assets/presenter/presenter-default.png';

// ─────────────────────────────────────────────────────────────────────────────
// EnterpriseExportInput — extends base with enterprise-specific data
// ─────────────────────────────────────────────────────────────────────────────

export interface EnterpriseExportInput extends RemotionExportInput {
  storyArc?:           StoryArc;
  businessValueOutputs?: BusinessValueOutput[];
}

// ─────────────────────────────────────────────────────────────────────────────
// EnterpriseRemotionExporter
// ─────────────────────────────────────────────────────────────────────────────

export class EnterpriseRemotionExporter {
  private readonly baseExporter: RemotionExporter;

  constructor() {
    this.baseExporter = new RemotionExporter({
      compositionId:  'EnterpriseVideo',
      outputFileName: 'demo-package.json',
    });
  }

  async export(input: EnterpriseExportInput): Promise<RemotionExportResult> {
    const fps = 30;

    // ── 1. Run base exporter to get screenshots written and base scenes ──────
    const baseResult = await this.baseExporter.export(input);
    const basePkg    = baseResult.package;

    // ── 2. Build B-roll scenes (problem statement, before product demo) ──────
    const brollSubtitles = this.generateBRollSubtitles(
      input.storyArc,
      input.meta.productName,
    );
    const brollDurationFrames = BROLL_SCENE_SEC * fps;
    const brollScenes: EnterpriseBRollSceneData[] = brollSubtitles.map((subtitle, i) => ({
      id:               `broll-${i}`,
      from:             i * brollDurationFrames,
      durationInFrames: brollDurationFrames,
      subtitle,
      category:         this.detectIndustryCategory(input.storyArc),
    }));

    const brollTotalFrames = brollScenes.length * brollDurationFrames;

    // ── 3. Place product demo scenes after brollScenes, with a per-scene cap ─
    // Enterprise uses static camera so scenes don't need the long Ken-Burns
    // durations; cap each at PRODUCT_SCENE_MAX_SEC to keep total frames low.
    // Deduplicate by screenshotPath so each scene shows a visually distinct view.
    const maxSceneFrames = PRODUCT_SCENE_MAX_SEC * fps;
    let productCursor = brollTotalFrames;
    const seenScreenshots = new Set<string>();
    const shiftedScenes = basePkg.scenes
      .filter(scene => {
        const p = scene.screenshotPath;
        if (!p) return true; // keep scenes without screenshots
        if (seenScreenshots.has(p)) return false; // skip duplicate
        seenScreenshots.add(p);
        return true;
      })
      .map(scene => {
        const dur  = Math.min(scene.durationInFrames, maxSceneFrames);
        const from = productCursor;
        productCursor += dur;
        return { ...scene, from, durationInFrames: dur };
      });

    // ── 4. Benefit slide ─────────────────────────────────────────────────────
    const lastScene = shiftedScenes[shiftedScenes.length - 1];
    const benefitSlideFrom =
      lastScene
        ? lastScene.from + lastScene.durationInFrames
        : brollTotalFrames;

    const benefitBullets = this.generateBenefitBullets(
      input.businessValueOutputs ?? [],
      input.meta.productName,
    );

    const benefitSlide: EnterpriseBenefitSlideData = {
      from:             benefitSlideFrom,
      durationInFrames: BENEFIT_SLIDE_SEC * fps,
      title:            `${input.meta.productName} — Value Adds`,
      bullets:          benefitBullets,
    };

    // ── 5. Presenter close ───────────────────────────────────────────────────
    const presenterCloseFrom = benefitSlideFrom + BENEFIT_SLIDE_SEC * fps;
    const tagline = this.buildClosingTagline(input.storyArc, input.meta.primaryBenefit);

    const presenterClose: EnterprisePresenterCloseData = {
      from:             presenterCloseFrom,
      durationInFrames: PRESENTER_CLOSE_SEC * fps,
      tagline,
      presenterSrc:     ENTERPRISE_PRESENTER_SRC,
    };

    // ── 6. Presenter config ──────────────────────────────────────────────────
    const presenterConfig: EnterprisePresenterConfig = {
      src:           ENTERPRISE_PRESENTER_SRC,
      widthFraction: 0.15,
      position:      'bottom-left',
    };

    // ── 7. Recompute total frames from the cursor position ───────────────────
    const totalFrames = productCursor + BENEFIT_SLIDE_SEC * fps + PRESENTER_CLOSE_SEC * fps;

    // ── 8. Assemble final enterprise package ─────────────────────────────────
    const enterprisePkg: RemotionPackage = {
      ...basePkg,
      id: randomUUID(),
      meta: {
        ...basePkg.meta,
        templateId: 'enterprise',
      },
      composition: {
        ...basePkg.composition,
        id:               'EnterpriseVideo',
        durationInFrames: totalFrames,
      },
      scenes:          shiftedScenes,
      // Keep openingCard + closingCard for schema backward compat; EnterpriseVideo ignores them
      closingCard: {
        ...basePkg.closingCard,
        from: presenterCloseFrom, // align timing
      },
      brollScenes,
      benefitSlide,
      presenterClose,
      presenterConfig,
    };

    // ── 9. Overwrite demo-package.json with enterprise data ──────────────────
    const outputPath = path.join(input.outputDir, 'demo-package.json');
    fs.writeFileSync(outputPath, JSON.stringify(enterprisePkg, null, 2), 'utf-8');

    return { package: enterprisePkg, outputPath };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // B-roll subtitle generation
  // ──────────────────────────────────────────────────────────────────────────

  private generateBRollSubtitles(arc: StoryArc | undefined, productName: string): string[] {
    if (!arc) {
      return [
        `Managing ${productName.toLowerCase()} is complex`,
        `Teams need accurate, up-to-date information to act`,
        `Manual processes consume valuable time every day`,
      ];
    }

    // Subtitle 1: core problem from arc premise (abbreviated to ≤ 10 words)
    const sub1 = this.shortenToPhrase(arc.premise, 10);

    // Subtitle 2: specific operational challenge from first scene hook
    const firstScene = arc.scenes[0];
    const sub2 = firstScene?.businessOutcome.narrativeHook
      ? this.shortenToPhrase(firstScene.businessOutcome.narrativeHook, 11)
      : `Teams need accurate data to make informed decisions`;

    // Subtitle 3: daily manual effort implied by second feature
    const secondScene = arc.scenes[1] ?? firstScene;
    const featureName = secondScene?.feature ?? productName;
    const sub3 = `Manual ${featureName.toLowerCase()} processes take hours, every day`;

    return [sub1, sub2, sub3];
  }

  /** Trim a sentence to at most maxWords while keeping it grammatical. */
  private shortenToPhrase(sentence: string, maxWords: number): string {
    const words = sentence.split(/\s+/);
    if (words.length <= maxWords) return sentence;
    // Cut at last complete clause boundary within maxWords
    const clipped = words.slice(0, maxWords).join(' ');
    // Strip trailing prepositions/conjunctions that dangle after cutting
    return clipped.replace(/\s+(and|or|but|for|to|of|in|on|the|a|an)$/i, '');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Benefit bullets from BusinessValueStage outputs
  // ──────────────────────────────────────────────────────────────────────────

  private generateBenefitBullets(
    outputs: BusinessValueOutput[],
    productName: string,
  ): EnterpriseBenefitBullet[] {
    const top5 = outputs
      .filter(o => o.source === 'llm' && o.salesNarration)
      .slice(0, 5);

    if (top5.length === 0) {
      // Fallback bullets when BusinessValueStage wasn't run or produced no LLM copy
      return this.fallbackBullets(productName);
    }

    return top5.map((o, i): EnterpriseBenefitBullet => ({
      icon:        this.iconForIndex(i),
      label:       o.featureName,
      description: this.truncateToOneSentence(o.salesNarration ?? o.customerOutcome),
    }));
  }

  /** Cycle through distinct icon keys so consecutive bullets look varied. */
  private iconForIndex(i: number): BenefitIconKey {
    const cycle: BenefitIconKey[] = ['speed', 'accuracy', 'oversight', 'revenue', 'compliance'];
    return cycle[i % cycle.length] ?? 'default';
  }

  private fallbackBullets(productName: string): EnterpriseBenefitBullet[] {
    return [
      { icon: 'speed',       label: 'Faster Processing',    description: `Reduces manual effort from hours to minutes.` },
      { icon: 'accuracy',    label: 'Improved Accuracy',    description: `Correct data for every record, minimising errors.` },
      { icon: 'oversight',   label: 'Human Oversight',      description: `Critical review points keep your team in control.` },
      { icon: 'revenue',     label: 'Revenue Protection',   description: `Accurate records reduce rejections and delays.` },
      { icon: 'integration', label: 'Seamless Integration', description: `Works directly within your existing systems.` },
    ];
  }

  private truncateToOneSentence(text: string): string {
    const dot = text.indexOf('. ');
    return dot > 0 ? text.slice(0, dot + 1) : text.split('\n')[0] ?? text;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Closing tagline
  // ──────────────────────────────────────────────────────────────────────────

  private buildClosingTagline(arc: StoryArc | undefined, fallback: string): string {
    if (!arc?.resolution) return fallback;
    // Resolution is typically "ProductName turns every data point into a prevention strategy"
    // Strip the product name prefix to get a clean tagline
    const res = arc.resolution;
    const firstSpace = res.indexOf(' ');
    const afterName  = firstSpace > 0 ? res.slice(firstSpace + 1) : res;
    return this.shortenToPhrase(afterName, 8);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Industry detection
  // ──────────────────────────────────────────────────────────────────────────

  private detectIndustryCategory(arc: StoryArc | undefined): string {
    if (!arc) return 'generic';
    const text = `${arc.premise} ${arc.arcNarrative}`.toLowerCase();
    if (/health|medical|clinical|patient|hospital|drug|pharmacy|formulary/.test(text)) return 'healthcare';
    if (/financ|bank|payment|invoice|billing|revenue|budget/.test(text))               return 'finance';
    if (/manufactur|logistics|supply|warehouse|inventory|fleet/.test(text))            return 'logistics';
    if (/energy|utilities|building|facility|hvac|equipment/.test(text))                return 'facilities';
    return 'generic';
  }
}
