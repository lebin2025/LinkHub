/**
 * OCR 服务（Mock 先行）。
 *
 * 仅对图片/文件类消息执行。置信度低于 OCR_CONFIDENCE_THRESHOLD 时，
 * 由消息中枢标记 needsReview（待人工确认），失败则回退占位不崩。
 * 特别地：正文含 [[LOW_CONF]] 模拟低置信，[[OCR_FAIL]] 模拟失败（用于单测）。
 */
import { UnifiedMessage } from '@unimsg/shared';

export type OcrResult =
  | { ok: true; text: string; confidence: number }
  | { ok: false; reason: string };

export class OcrService {
  async recognize(msg: UnifiedMessage): Promise<OcrResult> {
    if (msg.type !== 'image' && msg.type !== 'file') {
      return { ok: true, text: '', confidence: 1 };
    }
    const body = msg.body ?? '';
    if (body.includes('[[OCR_FAIL]]')) return { ok: false, reason: 'mock_ocr_failure' };

    const low = body.includes('[[LOW_CONF]]');
    return {
      ok: true,
      text: low ? '（图片文字，识别置信度偏低）' : '（图片识别文字：报销单/周报截图）',
      confidence: low ? 0.55 : 0.92,
    };
  }
}
