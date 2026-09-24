/**
 * The subset of the Barcode Detection API the scan screen uses.
 *
 * Not in TypeScript's DOM lib: it is a Chromium-only API, which is exactly
 * why the camera path feature-detects rather than assuming it. Android
 * Chrome on the warehouse handheld has it; desktop Firefox and Safari do not,
 * and there the camera button is simply not offered.
 *
 * Declared globally rather than imported so `"BarcodeDetector" in window`
 * narrows without a cast at the call site.
 */
interface DetectedBarcode {
  rawValue: string;
  format: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
  static getSupportedFormats(): Promise<string[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
