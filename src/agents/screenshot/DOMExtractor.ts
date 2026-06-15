import type { Page } from 'playwright';
import type { DOMSnapshot } from '../../core/domain/entities/PageCapture';

const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB — prevent storing massive SPAs verbatim
const MAX_TEXT_CHARS = 10_000;
const MAX_HEADINGS = 50;
const MAX_LINKS = 200;
const MAX_LANDMARKS = 30;

/** Shape returned by the in-browser evaluate call. */
interface BrowserSnapshot {
  title: string;
  url: string;
  textContent: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  formCount: number;
  inputCount: number;
  buttonCount: number;
  imageCount: number;
  ariaLandmarks: string[];
}

export class DOMExtractor {
  async extract(page: Page): Promise<DOMSnapshot> {
    const [rawHtml, snapshot] = await Promise.all([
      page.content(),
      page.evaluate(
        // Arrow function must be serialisable — all literals inlined,
        // no external variable references.
        (): BrowserSnapshot => {
          const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
            .map(el => el.textContent?.trim() ?? '')
            .filter(Boolean)
            .slice(0, 50);

          const links = Array.from(document.querySelectorAll('a[href]'))
            .map(el => ({
              text: el.textContent?.trim() ?? '',
              href: (el as HTMLAnchorElement).href,
            }))
            .filter(l => l.href.startsWith('http'))
            .slice(0, 200);

          const ariaLandmarks = Array.from(document.querySelectorAll('[role]'))
            .map(el => el.getAttribute('role') ?? '')
            .filter(Boolean)
            .slice(0, 30);

          const bodyText = document.body
            ? (document.body as HTMLElement).innerText ?? ''
            : '';

          return {
            title: document.title,
            url: window.location.href,
            textContent: bodyText.slice(0, 10_000),
            headings,
            links,
            formCount: document.querySelectorAll('form').length,
            inputCount: document.querySelectorAll('input,textarea').length,
            buttonCount: document.querySelectorAll('button').length,
            imageCount: document.querySelectorAll('img').length,
            ariaLandmarks,
          };
        },
      ),
    ]);

    // Truncate HTML if it exceeds the hard cap (avoids storing 10MB SPAs)
    const html =
      Buffer.byteLength(rawHtml, 'utf-8') > MAX_HTML_BYTES
        ? rawHtml.slice(0, MAX_HTML_BYTES)
        : rawHtml;

    return { html, ...snapshot };
  }
}

// Re-export constants so callers can reference the same caps if needed.
export { MAX_HTML_BYTES, MAX_TEXT_CHARS, MAX_HEADINGS, MAX_LINKS, MAX_LANDMARKS };
