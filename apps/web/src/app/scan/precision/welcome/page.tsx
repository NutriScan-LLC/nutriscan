'use client';
import { useRouter } from 'next/navigation';
import { ClockIcon, HandIcon } from '@/components/icons';
import ScannerLayout from '@/components/scan/ScannerLayout';

export default function PrecisionWelcomePage() {
  const router = useRouter();
  return <ScannerLayout
    icon={HandIcon}
    eyebrow="Precision Scan"
    title="Four measurements, one Precision result"
    description="NutriScan will guide you through four separate hand measurements, then securely ask the server to calculate your Precision AOX result."
    primaryAction={{ label: 'Check scanner setup', onClick: () => router.push('/scan/precision/system-check') }}
    secondaryAction={{ label: 'Use Quick Scan instead', onClick: () => router.push('/scan/welcome') }}
  >
    <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-slate-600">
      <ClockIcon className="h-5 w-5 shrink-0 text-emerald-700" />
      Each measurement repeats Place your hand → Hold still → Remove your hand.
    </div>
  </ScannerLayout>;
}
