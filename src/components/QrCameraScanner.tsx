"use client"

/**
 * EASTCHAIN — Live camera QR scanner
 * ─────────────────────────────────────────────────────────────────────
 * Previously every "scan QR" mode in this app just showed a placeholder
 * saying "Camera scanning not available in browser" — there was no
 * actual technical blocker, camera access via getUserMedia() + QR
 * decoding is a solved problem on the web (and works fine inside
 * Telegram's Mini App WebView too). This was just never built.
 *
 * Uses qr-scanner (worker-based decoding, doesn't block the UI thread)
 * over the raw jsQR/getUserMedia combo for better performance and less
 * boilerplate around camera selection/torch/etc.
 */
import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { AlertTriangle, Loader2, CameraOff } from 'lucide-react';

interface QrCameraScannerProps {
  onScan: (result: string) => void;
  onError?: (message: string) => void;
  /** Optional: only accept results matching this pattern (e.g. /^0x/ or /^wc:/) — others are ignored, scanning continues. */
  filter?: (result: string) => boolean;
}

export function QrCameraScanner({ onScan, onError, filter }: QrCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [status, setStatus] = useState<'requesting' | 'scanning' | 'no-camera' | 'denied'>('requesting');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const hasCamera = await QrScanner.hasCamera();
      if (cancelled) return;
      if (!hasCamera) {
        setStatus('no-camera');
        onError?.('No camera detected on this device.');
        return;
      }

      if (!videoRef.current) return;

      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          const text = result.data;
          if (filter && !filter(text)) return; // ignore non-matching codes, keep scanning
          scanner.stop();
          onScan(text);
        },
        {
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 5,
        }
      );
      scannerRef.current = scanner;

      try {
        await scanner.start();
        if (!cancelled) setStatus('scanning');
      } catch (err: any) {
        if (!cancelled) {
          setStatus('denied');
          onError?.(err?.message || 'Camera permission denied.');
        }
      }
    })();

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current?.destroy();
    };
  }, [onScan, onError, filter]);

  if (status === 'no-camera' || status === 'denied') {
    return (
      <div className="h-56 bg-secondary/30 rounded-xl border border-primary/10 flex flex-col items-center justify-center gap-2 text-muted-foreground p-4">
        <CameraOff className="w-8 h-8 text-primary/40" />
        <p className="text-[10px] uppercase font-bold text-center">
          {status === 'no-camera' ? 'No camera found on this device' : 'Camera permission denied'}
        </p>
        <p className="text-[9px] text-center opacity-70">
          {status === 'denied' ? 'Check your browser/Telegram camera permission settings and try again.' : 'Enter the address manually instead.'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-56 rounded-xl overflow-hidden bg-black">
      <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
      {status === 'requesting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-[10px] text-white uppercase font-bold">Requesting camera access...</p>
        </div>
      )}
    </div>
  );
}
