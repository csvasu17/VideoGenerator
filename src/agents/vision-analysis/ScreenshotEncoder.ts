import type { ImageContent } from '../../core/ports/services/ILLMProvider';

export type SupportedMimeType = 'image/png' | 'image/jpeg';

export class ScreenshotEncoder {
  /**
   * Encode a raw screenshot buffer as an LLM-ready ImageContent block.
   * Prefers PNG; falls back to JPEG if the buffer carries JPEG magic bytes.
   */
  encode(buffer: Buffer): ImageContent {
    return {
      type: 'image',
      data: buffer,
      mimeType: this.detectMimeType(buffer),
    };
  }

  /** Convert a buffer to a base64 string (useful for data-URL generation). */
  toBase64(buffer: Buffer): string {
    return buffer.toString('base64');
  }

  /** Build a data-URL string for embedding in HTML or logs. */
  toDataUrl(buffer: Buffer): string {
    const mime = this.detectMimeType(buffer);
    return `data:${mime};base64,${this.toBase64(buffer)}`;
  }

  private detectMimeType(buffer: Buffer): SupportedMimeType {
    // JPEG starts with FF D8 FF
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    return 'image/png';
  }
}
