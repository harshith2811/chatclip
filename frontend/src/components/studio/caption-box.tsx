'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Share2, ExternalLink, ShieldCheck, RotateCcw, Edit3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SocialPlatform = 'tiktok' | 'shorts' | 'reels' | 'x';

interface CaptionBoxProps {
  clipTitle?: string;
  sourceUrl?: string;
  channelName?: string;
  licenseStatus?: string;
  captionPackage?: {
    hook_title?: string;
    hook_opening?: string;
    core_summary?: string;
    creator_credit?: string;
    thank_you_note?: string;
    legal_disclaimer?: string;
    targeted_hashtags?: string[];
    platform_variants?: {
      youtube_shorts?: string;
      instagram_reels?: string;
      tiktok?: string;
      [key: string]: string | undefined;
    };
    full_copy_caption?: string;
  };
  className?: string;
}

export function CaptionBox({
  clipTitle = '',
  sourceUrl = '',
  channelName = '',
  licenseStatus,
  captionPackage,
  className,
}: CaptionBoxProps) {
  const [activePlatform, setActivePlatform] = React.useState<SocialPlatform>('tiktok');
  const [copied, setCopied] = React.useState(false);

  const defaultCaptions = React.useMemo<Record<SocialPlatform, string>>(() => {
    if (captionPackage) {
      const hashtags = (captionPackage.targeted_hashtags || []).join(' ');
      const credit = captionPackage.creator_credit || (channelName ? `Credit: ${channelName}` : '');
      const variants = captionPackage.platform_variants || {};

      return {
        tiktok: variants.tiktok || captionPackage.full_copy_caption || `${captionPackage.hook_title || clipTitle}\n\n${captionPackage.core_summary || ''}\n\n${credit}\n\n${hashtags}`,
        shorts: variants.youtube_shorts || captionPackage.full_copy_caption || `${captionPackage.hook_title || clipTitle}\n\n${captionPackage.core_summary || ''}\n\n${credit}\n\n${hashtags}`,
        reels: variants.instagram_reels || captionPackage.full_copy_caption || `${captionPackage.hook_title || clipTitle}\n\n${captionPackage.core_summary || ''}\n\n${credit}\n\n${hashtags}`,
        x: `${captionPackage.hook_title || clipTitle}\n\n${captionPackage.core_summary || ''}\n\n${sourceUrl || ''}\n\n${hashtags}`,
      };
    }

    if (clipTitle || channelName) {
      const channel = channelName || 'Creator';
      return {
        tiktok: `${clipTitle}\n\nAnalysis from ${channel}.\n\n#Shorts #ClipIntel`,
        shorts: `${clipTitle}\n\nKey moment from ${channel}.\n\n#Shorts`,
        reels: `${clipTitle}\n\nHighlight from ${channel}.\n\n#Reels`,
        x: `${clipTitle}\n\nCredit to ${channel}${sourceUrl ? `\n\n${sourceUrl}` : ''}`,
      };
    }

    return {
      tiktok: '',
      shorts: '',
      reels: '',
      x: '',
    };
  }, [captionPackage, clipTitle, channelName, sourceUrl]);

  const [platformCaptions, setPlatformCaptions] = React.useState<Record<SocialPlatform, string>>(defaultCaptions);

  // Sync if source channel or URL changes
  React.useEffect(() => {
    setPlatformCaptions(defaultCaptions);
  }, [defaultCaptions]);

  const currentText = platformCaptions[activePlatform];
  const isCustomized = currentText !== defaultCaptions[activePlatform];

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPlatformCaptions((prev) => ({
      ...prev,
      [activePlatform]: val,
    }));
  };

  const handleResetToDefault = () => {
    setPlatformCaptions((prev) => ({
      ...prev,
      [activePlatform]: defaultCaptions[activePlatform],
    }));
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Platform character limits
  const charLimits: Record<SocialPlatform, number> = {
    tiktok: 2200,
    shorts: 100, // Short title limit
    reels: 2200,
    x: 280,
  };

  const charLimit = charLimits[activePlatform];
  const isOverLimit = currentText.length > charLimit;

  return (
    <Card className={cn('bg-card/70 backdrop-blur-xs border-border/80 tactile-panel', className)}>
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-bold text-foreground">
              Multi-Platform Captions & Attribution
            </CardTitle>
          </div>
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            {isCustomized && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetToDefault}
                className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                title="Restore default generated caption"
              >
                <RotateCcw className="w-3 h-3" />
                Restore Default
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="h-7 text-xs gap-1.5 cursor-pointer shadow-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy Caption'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-3">
        {/* Platform Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted/40 border border-border/60">
          {(['tiktok', 'shorts', 'reels', 'x'] as const).map((platform) => (
            <button
              key={platform}
              type="button"
              onClick={() => setActivePlatform(platform)}
              className={cn(
                'flex-1 py-1 rounded text-xs font-semibold capitalize transition-all cursor-pointer flex items-center justify-center gap-1',
                activePlatform === platform
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span>
                {platform === 'shorts' ? 'YouTube Shorts' : platform === 'reels' ? 'Instagram Reels' : platform === 'x' ? 'X (Twitter)' : 'TikTok'}
              </span>
              {platformCaptions[platform] !== defaultCaptions[platform] && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Customized" />
              )}
            </button>
          ))}
        </div>

        {/* Caption Editor Textarea with Character Budget */}
        <div className="space-y-1.5">
          <div className="relative">
            <textarea
              value={currentText}
              onChange={handleTextChange}
              rows={4}
              className={cn(
                'w-full p-3 rounded-lg border bg-muted/20 font-sans text-xs leading-relaxed text-foreground select-text resize-y focus:outline-none focus:ring-2 focus:ring-ring transition-colors',
                isOverLimit ? 'border-rose-500/80 focus:ring-rose-500' : 'border-border/60'
              )}
              placeholder="Edit caption or hashtags..."
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <Edit3 className="w-3 h-3 text-muted-foreground" />
                {isCustomized ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500">
                    Customized
                  </Badge>
                ) : (
                  <span className="text-[10px]">Default Template</span>
                )}
              </span>
            </div>
            <span className={cn('font-mono tnum', isOverLimit ? 'text-rose-500 font-bold' : 'text-muted-foreground')}>
              {currentText.length} / {charLimit} chars
            </span>
          </div>
        </div>

        {/* Attribution & Legal Safeguard Notice */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1.5 border-t border-border/40">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>
              {channelName ? (
                <>
                  Attribution: <strong>{channelName}</strong>{' '}
                  {licenseStatus && (licenseStatus.toLowerCase().includes('creative') || licenseStatus.toLowerCase().includes('cc'))
                    ? '(CC-BY Rights Gate Verified)'
                    : licenseStatus
                    ? `(${licenseStatus})`
                    : '(Standard License Attribution)'}
                </>
              ) : (
                'Attribution: Pending clip selection'
              )}
            </span>
          </div>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline self-start sm:self-auto"
          >
            <span>Original Source</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
