export interface SubtitleStyle {
  id: string;
  name: string;
  preview: string;
  color: string;
}

export const SUBTITLE_STYLES: SubtitleStyle[] = [
  {
    id: 'bold-yellow',
    name: 'Viral Yellow Pop',
    preview: 'THE SECRET',
    color: 'text-yellow-400 bg-black/90 font-black border border-yellow-400/40',
  },
  {
    id: 'neon-cyan',
    name: 'Cyberpunk Cyan',
    preview: '100% REAL',
    color: 'text-cyan-400 bg-slate-950 font-extrabold border border-cyan-400/50 shadow-cyan-500/20',
  },
  {
    id: 'clean-white',
    name: 'Minimal Editorial',
    preview: 'Watch closely.',
    color: 'text-white bg-black/80 font-semibold border border-white/20',
  },
  {
    id: 'gradient-fire',
    name: 'Fire Gradient',
    preview: 'UNBELIEVABLE',
    color: 'text-orange-400 bg-black/90 font-black border border-orange-500/40',
  },
];
