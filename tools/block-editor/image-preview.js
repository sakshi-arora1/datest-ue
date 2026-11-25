export function createImagePreviews(sdk, { onChange }) {
  const images = new Map();
  const controller = new AbortController();
  let disposed = false;

  return {
    get(src) {
      if (disposed) return undefined;
      let source;
      try { source = new URL(src); } catch { return src; }
      if (source.protocol !== 'https:'
        || !['content.da.live', 'stage-content.da.live'].includes(source.hostname)) return src;
      const { hash } = source;
      source.hash = '';
      const key = source.href;
      if (!images.has(key)) {
        const image = {};
        images.set(key, image);
        Promise.resolve().then(async () => {
          if (disposed) return;
          if (!sdk.token) throw new Error('The host did not supply an authentication token.');
          const response = await sdk.actions.daFetch(key, {
            credentials: 'omit',
            headers: { Authorization: `Bearer ${sdk.token}` },
            noRedirect: true,
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
          const blob = await response.blob();
          if (!blob.size || !blob.type.startsWith('image/')) {
            throw new Error('The image response was empty or did not contain an image.');
          }
          if (disposed) return;
          image.url = URL.createObjectURL(blob);
          onChange();
        }).catch((error) => {
          if (!disposed) onChange(`Unable to load image preview: ${error.message}. Reload to retry.`);
        });
      }
      const { url } = images.get(key);
      return url ? `${url}${hash}` : undefined;
    },
    dispose() {
      disposed = true;
      controller.abort();
      images.forEach(({ url }) => { if (url) URL.revokeObjectURL(url); });
      images.clear();
    },
  };
}
