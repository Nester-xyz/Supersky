import { useEffect, useState } from 'react';
import { DraftsIcon, GifIcon, ImageIcon, TrashIcon, VideoIcon, XIcon } from './icons';
import { IconButton, Spinner, cx } from './ui';
import { deleteSavedDraft, listSavedDrafts, MAX_DRAFTS, type SavedDraft } from '@/lib/draft';

/**
 * The drafts shelf: save the current post for later, reopen a saved one, or
 * delete it. Drafts live in extension storage on this device, like the
 * official app's drafts live on-device.
 */
export function DraftsSheet({
  composerDirty,
  canSaveCurrent,
  onSaveCurrent,
  onLoad,
  onClose,
}: {
  /** The composer holds content that loading a draft would replace. */
  composerDirty: boolean;
  canSaveCurrent: boolean;
  onSaveCurrent: () => Promise<void>;
  onLoad: (draft: SavedDraft) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<SavedDraft[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    void listSavedDrafts().then((list) => mounted && setDrafts(list));
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

  async function saveCurrent() {
    setSaving(true);
    setError('');
    try {
      await onSaveCurrent();
      setDrafts(await listSavedDrafts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the draft.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setDrafts(await deleteSavedDraft(id));
    if (confirmingId === id) setConfirmingId(null);
  }

  function requestLoad(draft: SavedDraft) {
    if (composerDirty && confirmingId !== draft.id) {
      setConfirmingId(draft.id);
      return;
    }
    onLoad(draft);
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end bg-black/45"
      onClick={onClose}
      role="dialog"
      aria-label="Drafts"
    >
      <div
        className="card animate-slide-up m-2 flex max-h-[440px] w-full flex-col p-3.5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">
            Drafts
            {drafts && drafts.length > 0 && (
              <span className="ml-1.5 text-xs font-medium text-ink-faint">
                {drafts.length}/{MAX_DRAFTS}
              </span>
            )}
          </h3>
          <IconButton title="Close" onClick={onClose} className="size-7 bg-surface-2 hover:bg-surface-3">
            <XIcon size={14} />
          </IconButton>
        </div>

        {canSaveCurrent && (
          <button
            type="button"
            onClick={() => void saveCurrent()}
            disabled={saving}
            className="btn btn-outline mt-3 h-9 w-full gap-2"
          >
            {saving ? <Spinner size={14} /> : <DraftsIcon size={15} />}
            Save current post as draft
          </button>
        )}
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {drafts === null && (
            <div className="flex h-24 items-center justify-center">
              <Spinner size={16} className="text-ink-faint" />
            </div>
          )}

          {drafts?.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <DraftsIcon size={26} className="text-ink-faint" />
              <p className="mt-2.5 text-[13px] font-medium text-ink">No drafts yet</p>
              <p className="mt-0.5 max-w-[240px] text-xs leading-snug text-ink-faint">
                Save a post you’re not ready to publish and pick it back up any time.
              </p>
            </div>
          )}

          {drafts?.map((draft) => (
            <DraftRow
              key={draft.id}
              draft={draft}
              confirming={confirmingId === draft.id}
              onOpen={() => requestLoad(draft)}
              onCancelConfirm={() => setConfirmingId(null)}
              onDelete={() => void remove(draft.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  confirming,
  onOpen,
  onCancelConfirm,
  onDelete,
}: {
  draft: SavedDraft;
  confirming: boolean;
  onOpen: () => void;
  onCancelConfirm: () => void;
  onDelete: () => void;
}) {
  const thumb = draft.images[0];
  return (
    <div className="group border-t border-line first:border-t-0">
      <div className="flex items-center gap-2.5 py-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
        >
          {thumb ? (
            <img
              src={`data:${thumb.mime};base64,${thumb.base64}`}
              alt=""
              className="size-10 shrink-0 rounded-lg border border-line object-cover"
            />
          ) : draft.gif ? (
            <img
              src={draft.gif.previewUrl}
              alt=""
              className="size-10 shrink-0 rounded-lg border border-line object-cover"
            />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-faint">
              <DraftsIcon size={16} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span
              className={cx(
                'block truncate text-[13px] leading-snug',
                draft.text ? 'text-ink' : 'text-ink-faint italic',
              )}
            >
              {draft.text ? firstLine(draft.text) : 'No text'}
            </span>
            <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
              {relativeTime(draft.savedAt)}
              {draft.images.length > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  <ImageIcon size={11} /> {draft.images.length}
                </span>
              )}
              {draft.gif && (
                <span className="inline-flex items-center gap-0.5">
                  <GifIcon size={11} /> GIF
                </span>
              )}
              {draft.hadVideo && (
                <span className="inline-flex items-center gap-0.5">
                  <VideoIcon size={11} /> video not saved
                </span>
              )}
            </span>
          </span>
        </button>
        <IconButton
          title="Delete draft"
          onClick={onDelete}
          className="size-7 text-ink-faint hover:text-danger"
        >
          <TrashIcon size={14} />
        </IconButton>
      </div>

      {confirming && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2">
          <p className="min-w-0 flex-1 text-xs leading-snug text-ink-muted">
            Opening this draft replaces what you’re writing.
          </p>
          <button type="button" className="btn btn-outline h-7 shrink-0 px-2.5 text-xs" onClick={onCancelConfirm}>
            Keep editing
          </button>
          <button type="button" className="btn btn-primary h-7 shrink-0 px-2.5 text-xs" onClick={onOpen}>
            Open
          </button>
        </div>
      )}
    </div>
  );
}

function firstLine(text: string): string {
  return text.split('\n', 1)[0] ?? text;
}

function relativeTime(timestamp: number): string {
  const deltaS = Math.max(0, (Date.now() - timestamp) / 1000);
  if (deltaS < 60) return 'just now';
  if (deltaS < 3600) return `${Math.floor(deltaS / 60)}m ago`;
  if (deltaS < 86_400) return `${Math.floor(deltaS / 3600)}h ago`;
  if (deltaS < 7 * 86_400) return `${Math.floor(deltaS / 86_400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
