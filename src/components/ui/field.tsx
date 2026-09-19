import type { InputHTMLAttributes } from 'react';

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block text-sm font-medium">{label}<input {...props} className="mt-2 h-11 w-full rounded-xl border border-ink/15 bg-white px-3 focus:outline-none focus:ring-2 focus:ring-ember disabled:opacity-50" /></label>;
}
