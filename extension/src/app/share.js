import { t } from './i18n.js';
import { api, memberIds, state } from './state.js';
import { showNotice } from './toasts.js';
import { decodeShare, encodeShare, SHARE_PAYLOAD, shareUrl } from '../core/share.js';

const SHARED_ROUTE = /^#\/s\/(.+)$/;

export const sharedPayload = () => SHARED_ROUTE.exec(location.hash)?.[1] ?? null;

export const isSharedOnly = (g) => g === state.shared?.group;

export async function openShared(payload) {
  try {
    const { group } = await api('sharedGroup', await decodeShare(payload));
    state.shared = { group, payload };
    location.replace(`#/l/${encodeURIComponent(group.id)}`);
  } catch {
    location.replace('#/');
    showNotice(t('shareInvalid'));
  }
}

async function linkFor(g) {
  if (isSharedOnly(g) && SHARE_PAYLOAD.test(state.shared.payload)) return shareUrl(state.shared.payload);
  return shareUrl(await encodeShare(await api('shareListing', { ids: memberIds(g) })));
}

export async function shareListing(g) {
  try {
    const url = await linkFor(g);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: g.title, url });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    await navigator.clipboard.writeText(url);
    showNotice(t('shareCopied'), 'circle-check', 'done');
  } catch (err) {
    showNotice(`${t('shareFailed')}: ${err.message}`);
  }
}
