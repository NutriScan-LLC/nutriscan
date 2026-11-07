'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BrowserIcon, ScannerDeviceIcon, UsbIcon, WifiRingsIcon } from '@/components/icons';
import ScannerLayout from '@/components/scan/ScannerLayout';
import { usePrecisionAoxRun } from '@/lib/precision-aox/run-context';

export default function PrecisionSystemCheckPage() {
  const router = useRouter();
  const { capability, connection, event, outcome, running, startRun, clearCompletedRun } = usePrecisionAoxRun();
  const wifi = connection === 'wifi';
  const quickEvent = event?.state === 'constituent-progress' ? event.event : null;
  const identified = quickEvent?.state === 'awaiting-begin';
  useEffect(() => { if (identified) router.push('/scan/precision'); }, [identified, router]);
  return <ScannerLayout
    eyebrow="Precision Scan"
    title="Checking your setup"
    description={wifi
      ? 'The same scanner Wi-Fi connection stays active across all four measurements. Join the biozoomAP_ network first and keep cellular data on.'
      : 'The same Web Serial scanner connection stays active across all four measurements.'}
    primaryAction={{
      label: running ? 'Connecting to scanner…' : 'Connect scanner',
      disabled: capability !== 'supported' || running,
      onClick: () => { clearCompletedRun(); startRun(); },
    }}
  >
    <div className="space-y-3">
      <Check icon={BrowserIcon} label={wifi ? 'NutriScan app' : 'Compatible desktop browser'} ok={capability !== 'checking'} />
      {wifi
        ? <Check icon={WifiRingsIcon} label="NutriScan app Wi-Fi connection" ok={capability === 'supported'} />
        : <Check icon={UsbIcon} label="Web Serial available" ok={capability === 'supported'} failed={capability === 'unsupported'} />}
      <Check icon={ScannerDeviceIcon} label={identified ? 'Scanner identified' : 'Scanner connection'} ok={identified} failed={outcome?.kind === 'failed'} />
      {capability === 'unsupported' && <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Use the latest Chrome or Edge on a desktop computer, or the NutriScan app with a Wi-Fi scanner.</p>}
    </div>
  </ScannerLayout>;
}

function Check({ icon: Icon, label, ok, failed = false }: { icon: typeof BrowserIcon; label: string; ok: boolean; failed?: boolean }) {
  return <div className={`flex items-center gap-3 rounded-2xl border p-4 ${failed ? 'border-amber-200 bg-amber-50' : ok ? 'border-emerald-100 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
    <Icon className={`h-5 w-5 ${failed ? 'text-amber-700' : ok ? 'text-emerald-700' : 'text-slate-400'}`} />
    <span className="text-sm font-medium text-slate-800">{label}</span>
  </div>;
}
