import { useEffect, useState } from 'react';
import { CheckIcon, QuoteIcon, ReplyBubbleIcon, XIcon } from './icons';
import { IconButton, Spinner, Switch, cx } from './ui';
import {
  hasCustomRules,
  type InteractionSettings,
  type ReplyRules,
} from '@/lib/interaction';
import { sendMessage } from '@/lib/messaging';
import type { ListSuggestion } from '@/lib/types';

/**
 * Bottom sheet mirroring Bluesky's "post interaction settings": whether quote
 * posts are allowed (postgate) and who may reply (threadgate). Edits apply
 * live to the parent's state; Done only dismisses.
 */
export function InteractionSheet({
  settings,
  onChange,
  onClose,
}: {
  settings: InteractionSettings;
  onChange: (settings: InteractionSettings) => void;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<ListSuggestion[] | null>(null);
  const [listsFailed, setListsFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    sendMessage('lists:get', undefined)
      .then((result) => mounted && setLists(result))
      .catch(() => {
        if (mounted) {
          setLists([]);
          setListsFailed(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [onClose]);

  const replies = settings.replies;

  function setReplies(next: Partial<ReplyRules>) {
    onChange({ ...settings, replies: { ...replies, ...next } });
  }

  function toggleRule(rule: 'mention' | 'following' | 'followers') {
    setReplies({ mode: 'custom', [rule]: !replies[rule] });
  }

  function toggleList(uri: string) {
    const active = replies.lists.includes(uri);
    setReplies({
      mode: 'custom',
      lists: active ? replies.lists.filter((item) => item !== uri) : [...replies.lists, uri],
    });
  }

  const customSelected = replies.mode === 'custom';
  const nobodyEffective = replies.mode === 'nobody' || (customSelected && !hasCustomRules(replies));

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end bg-black/45"
      onClick={onClose}
      role="dialog"
      aria-label="Post interaction settings"
    >
      <div
        className="card animate-slide-up m-2 flex max-h-[390px] w-full flex-col p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Who can interact</h3>
          <IconButton title="Close" onClick={onClose} className="size-7 bg-surface-2 hover:bg-surface-3">
            <XIcon size={14} />
          </IconButton>
        </div>

        <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
          <section className="rounded-xl border border-line bg-surface-2/40 px-3 py-2">
            <div className="flex items-center gap-2.5">
              <QuoteIcon size={16} className="shrink-0 text-ink-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">Allow quote posts</p>
                <p className="text-[11px] leading-snug text-ink-faint">
                  Others can embed this post in their own.
                </p>
              </div>
              <Switch
                checked={settings.quotesEnabled}
                onChange={(quotesEnabled) => onChange({ ...settings, quotesEnabled })}
                label="Allow quote posts"
              />
            </div>
          </section>

          <section className="mt-2.5">
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <ReplyBubbleIcon size={15} className="text-ink-muted" />
              <p className="text-[13px] font-medium text-ink">Allow replies from</p>
            </div>

            <div className="overflow-hidden rounded-xl border border-line">
              <AudienceRow
                label="Everybody"
                selected={replies.mode === 'everybody'}
                onClick={() => setReplies({ mode: 'everybody' })}
              />
              <AudienceRow
                label="Nobody"
                selected={nobodyEffective}
                onClick={() =>
                  setReplies({
                    mode: 'nobody',
                    mention: false,
                    following: false,
                    followers: false,
                    lists: [],
                  })
                }
              />
            </div>

            <p className="mt-2 mb-1.5 px-1 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
              Or combine
            </p>
            <div className="overflow-hidden rounded-xl border border-line">
              <AudienceRow
                label="Mentioned users"
                selected={customSelected && replies.mention}
                onClick={() => toggleRule('mention')}
              />
              <AudienceRow
                label="People you follow"
                selected={customSelected && replies.following}
                onClick={() => toggleRule('following')}
              />
              <AudienceRow
                label="Your followers"
                selected={customSelected && replies.followers}
                onClick={() => toggleRule('followers')}
              />
              {lists === null && (
                <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-ink-faint">
                  <Spinner size={12} /> Loading your lists…
                </div>
              )}
              {lists?.map((list) => (
                <AudienceRow
                  key={list.uri}
                  label={list.name}
                  hint="List"
                  selected={customSelected && replies.lists.includes(list.uri)}
                  onClick={() => toggleList(list.uri)}
                />
              ))}
            </div>
            {listsFailed && (
              <p className="mt-1.5 px-1 text-[11px] text-ink-faint">
                Your lists could not be loaded right now.
              </p>
            )}
          </section>
        </div>

        <button type="button" className="btn btn-primary mt-2.5 h-8 w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function AudienceRow({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 border-t border-line bg-surface px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-surface-2"
    >
      <span
        className={cx(
          'min-w-0 flex-1 truncate text-[13px]',
          selected ? 'font-medium text-ink' : 'text-ink-muted',
        )}
      >
        {label}
        {hint && <span className="ml-1.5 text-[10px] font-semibold text-ink-faint uppercase">{hint}</span>}
      </span>
      <span
        className={cx(
          // aspect-square + border-2: hairline borders render lopsided on
          // circles at fractional device-pixel ratios.
          'grid size-[18px] shrink-0 aspect-square place-items-center rounded-full border-2 transition-colors',
          selected ? 'border-transparent bg-accent text-white' : 'border-line-strong text-transparent',
        )}
      >
        <CheckIcon size={11} />
      </span>
    </button>
  );
}
